'use strict';
require('dotenv').config();
const { tokenFor } = require('../services/livekit-config');
const sdk = require('../services/smartspectra');
const { orientFrame } = require('../services/video-frame');
const { FrameCadence } = require('../services/frame-cadence');

async function main() {
    const { Room, RoomEvent, VideoStream, VideoBufferType, RemoteVideoTrack, dispose } = await import('@livekit/rtc-node');
    const credentials = await tokenFor('worker');
    const room = new Room();
    let active = null;
    let error = null;
    let received = 0;
    let accepted = 0;
    let receivedFps = 0;
    let acceptedFps = 0;
    let windowStart = performance.now();
    let publishing = false;
    let interval;
    let closing = false;
    let captureFps = null;
    let captureUpdatedAt = 0;

    async function consume(track, participant) {
        if (!(track instanceof RemoteVideoTrack) || !participant.identity.startsWith('publisher-')) return;
        if (active) {
            await room.localParticipant.publishData(Buffer.from(JSON.stringify({ message: 'Another camera is scanning. Stop it first.' })),
                { reliable: true, topic: 'scan-error', destination_identities: [participant.identity] });
            return;
        }
        const state = { reader: new VideoStream(track).getReader(), track, identity: participant.identity, stopping: false,
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
        } catch (cause) {
            error = cause.message;
            console.error('LiveKit scan:', error);
        } finally {
            await state.reader.cancel().catch(() => {});
            if (started) await sdk.stopSmartSpectraSession().catch(cause => { error = cause.message; });
            active = null;
        }
    }
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        void consume(track, participant).catch(cause => { error = cause.message; });
    });
    room.on(RoomEvent.TrackUnsubscribed, track => {
        if (active?.track === track) {
            active.stopping = true;
            void active.reader.cancel().catch(() => {});
        }
    });
    room.on(RoomEvent.Disconnected, () => { void shutdown(); });
    room.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
        if (topic !== 'capture-fps' || participant?.identity !== active?.identity) return;
        try {
            const value = JSON.parse(Buffer.from(data).toString()).fps;
            if (Number.isFinite(value) && value >= 0 && value <= 240) {
                captureFps = value;
                captureUpdatedAt = Date.now();
            }
        } catch { /* Ignore malformed telemetry. */ }
    });
    await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
    interval = setInterval(async () => {
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
            // Keep the data packet below LiveKit's reliable message size limit.
            status.arterialPressureSeries = status.arterialPressureSeries.slice(-80);
            status.lastInsight = null;
            status.transport = { publisherIdentity: active?.identity || null, phase: active?.phase || (error ? 'error' : 'idle'),
                captureFps: Date.now() - captureUpdatedAt < 5000 ? captureFps : null,
                receivedFps, acceptedFps, error, timestampSource: 'LiveKit decoded media' };
            await room.localParticipant.publishData(Buffer.from(JSON.stringify(status)), { reliable: true, topic: 'vitals' });
        } catch (cause) { console.error('Status delivery:', cause.message); }
        finally { publishing = false; }
    }, 1000);
    async function shutdown() {
        if (closing) return;
        closing = true;
        clearInterval(interval);
        if (active) { active.stopping = true; await active.reader.cancel().catch(() => {}); }
        await sdk.stopSmartSpectraSession().catch(() => {});
        await room.disconnect();
        await dispose();
    }
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log('LiveKit worker connected. Waiting for a camera.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
