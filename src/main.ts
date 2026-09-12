const { AutoSubscribe, ServerOptions, cli, defineAgent } = require('@livekit/agents');
const { RemoteVideoTrack, RoomEvent, VideoBufferType, VideoStream, dispose } = require('@livekit/rtc-node');
const sdk = require('../services/smartspectra');
const { FrameCadence } = require('../services/frame-cadence');
const { orientFrame } = require('../services/video-frame');

async function requestFunc(job: any) {
    await job.accept('VitalScan Processor', 'processor');
}

async function runProcessor(ctx: any) {
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);
    const room = ctx.room;
    let active: any = null;
    let error: string | null = null;
    let received = 0;
    let accepted = 0;
    let receivedFps = 0;
    let acceptedFps = 0;
    let windowStart = performance.now();
    let publishing = false;
    let captureFps: number | null = null;
    let captureUpdatedAt = 0;

    async function consume(track: unknown, participant: { identity: string }) {
        if (!(track instanceof RemoteVideoTrack) || !participant.identity.startsWith('publisher-')) return;
        if (active) {
            await room.localParticipant?.publishData(Buffer.from(JSON.stringify({ message: 'Another camera is scanning. Stop it first.' })),
                { reliable: true, topic: 'scan-error', destination_identities: [participant.identity] });
            return;
        }
        const state: any = { reader: new VideoStream(track).getReader(), track, identity: participant.identity, stopping: false,
            lastFrameAt: Date.now(), createdAt: Date.now(), phase: 'warming' };
        active = state;
        error = null;
        received = accepted = receivedFps = acceptedFps = 0;
        windowStart = performance.now();
        const cadence = new FrameCadence();
        let started = false;
        try {
            while (!state.stopping) {
                const { value, done } = await state.reader.read();
                if (done || state.stopping) break;
                state.lastFrameAt = Date.now();
                const timestampUs = Number(value.timestampUs);
                if (!cadence.add(timestampUs, performance.now())) continue;
                received++;
                if (!started) {
                    if (!cadence.ready) {
                        if (Date.now() - state.createdAt > 20000) throw new Error('Video is below 25 fps or unstable. Use a stronger connection and keep Safari visible.');
                        continue;
                    }
                    await sdk.startSmartSpectraSession({ source: 'custom' });
                    started = true;
                    state.phase = 'measuring';
                }
                const frame = value.frame.convert(VideoBufferType.RGBA);
                const result = sdk.sendCustomFrame({ ...orientFrame(frame, value.rotation), timestampUs });
                if (result.accepted) accepted++;
            }
        } catch (cause: any) {
            error = cause.message;
            console.error('LiveKit agent scan:', error);
        } finally {
            await state.reader.cancel().catch(() => {});
            if (started) await sdk.stopSmartSpectraSession().catch((cause: Error) => { error = cause.message; });
            active = null;
        }
    }

    room.on(RoomEvent.TrackSubscribed, (track: any, _publication: any, participant: any) => {
        void consume(track, participant).catch((cause: Error) => { error = cause.message; });
    });
    room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        if (active?.track === track) {
            active.stopping = true;
            void active.reader.cancel().catch(() => {});
        }
    });
    room.on(RoomEvent.DataReceived, (data: any, participant: any, _kind: any, topic: any) => {
        if (topic !== 'capture-fps' || participant?.identity !== active?.identity) return;
        try {
            const value = JSON.parse(Buffer.from(data).toString()).fps;
            if (Number.isFinite(value) && value >= 0 && value <= 240) {
                captureFps = value;
                captureUpdatedAt = Date.now();
            }
        } catch { /* Ignore malformed telemetry. */ }
    });

    const interval = setInterval(async () => {
        if (active && Date.now() - active.lastFrameAt > 5000) {
            error = 'Camera frames stopped arriving. Start a new scan.';
            active.stopping = true;
            void active.reader.cancel().catch(() => {});
        }
        const now = performance.now();
        const seconds = (now - windowStart) / 1000;
        receivedFps = received / seconds;
        acceptedFps = accepted / seconds;
        received = accepted = 0;
        windowStart = now;
        if (publishing) return;
        publishing = true;
        try {
            const status = sdk.getSdkStatus();
            status.worker = { ready: status.available && status.hasApiKey };
            if (active?.phase === 'warming') {
                status.latestVitals = null;
                status.arterialPressureSeries = [];
                status.lastError = null;
                status.sessionFailed = false;
                status.validationStatus = { hint: 'Checking video frame rate' };
            }
            status.arterialPressureSeries = status.arterialPressureSeries.slice(-80);
            status.lastInsight = null;
            status.transport = { publisherIdentity: active?.identity || null, phase: active?.phase || (error ? 'error' : 'idle'),
                captureFps: Date.now() - captureUpdatedAt < 5000 ? captureFps : null,
                receivedFps, acceptedFps, error, timestampSource: 'LiveKit decoded media' };
            await room.localParticipant?.publishData(Buffer.from(JSON.stringify(status)), { reliable: true, topic: 'vitals' });
        } catch (cause: any) {
            console.error('Status delivery:', cause.message);
        } finally {
            publishing = false;
        }
    }, 1000);

    ctx.addShutdownCallback(async () => {
        clearInterval(interval);
        if (active) {
            active.stopping = true;
            await active.reader.cancel().catch(() => {});
        }
        await sdk.stopSmartSpectraSession().catch(() => {});
        await dispose();
    });

    console.log('VitalScan LiveKit Agent connected. Waiting for a camera.');
    await new Promise<void>(() => {});
}

const agent = defineAgent({
    entry: runProcessor,
});

cli.runApp(new ServerOptions({
    agent: __filename,
    agentName: process.env.LIVEKIT_AGENT_NAME || 'vitalscan-agent',
    requestFunc,
}));

module.exports = agent;
