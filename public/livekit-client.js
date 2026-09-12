import { Room, RoomEvent, LocalVideoTrack, Track, DisconnectReason, ConnectionErrorReason } from 'livekit-client';

let room, track, status, role, pending, tokenRequest, captureCallback;
let updatedAt = 0;
let generation = 0;
let captureFps = null;
let connectionError = null;
let scanError = null;

function announce(message) {
    window.dispatchEvent(new CustomEvent('livekit-state', { detail: message }));
}

async function connect(nextRole) {
    if (room?.state === 'connected' && role === nextRole) return;
    if (pending && role === nextRole) return pending;
    await disconnect();
    role = nextRole;
    const attempt = generation;
    const controller = new AbortController();
    tokenRequest = controller;
    pending = (async () => {
        announce('Connecting to LiveKit');
        const response = await fetch('/api/livekit/token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ role: nextRole, accessCode: document.getElementById('livekitCode').value.trim() }),
        });
        const credentials = await response.json();
        if (!response.ok) throw new Error(credentials.error || 'Unable to connect.');
        if (attempt !== generation) throw new Error('Connection cancelled.');
        const candidate = new Room({ adaptiveStream: false, dynacast: false });
        room = candidate;
        candidate.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
            if (room !== candidate || participant?.identity !== 'processor') return;
            try {
                const payload = JSON.parse(new TextDecoder().decode(data));
                if (topic === 'vitals') { status = payload; updatedAt = Date.now(); }
                if (topic === 'scan-error') scanError = payload.message || 'Camera not accepted.';
            } catch { /* Ignore malformed data packets. */ }
        });
        candidate.on(RoomEvent.ParticipantDisconnected, participant => {
            if (room === candidate && participant.identity === 'processor') {
                status = null;
                updatedAt = 0;
                announce('Processor offline');
                if (track) window.dispatchEvent(new Event('livekit-lost'));
            }
        });
        candidate.on(RoomEvent.Reconnecting, () => { if (room === candidate) announce('Reconnecting'); });
        candidate.on(RoomEvent.Reconnected, () => { if (room === candidate) announce('LiveKit connected'); });
        candidate.on(RoomEvent.Disconnected, reason => {
            if (room !== candidate) return;
            status = null;
            updatedAt = 0;
            connectionError = `LiveKit disconnected: ${DisconnectReason[reason] || 'network connection lost'}`;
            announce(connectionError);
            if (track) window.dispatchEvent(new Event('livekit-lost'));
        });
        try {
            await candidate.connect(credentials.url, credentials.token);
            if (attempt !== generation) { await candidate.disconnect(); throw new Error('Connection cancelled.'); }
            announce('LiveKit connected; checking processor');
        } catch (error) {
            const reason = error.reason === ConnectionErrorReason.LeaveRequest ? DisconnectReason[error.context] : error.reasonName;
            if (room === candidate) await disconnect();
            throw new Error(reason ? `LiveKit connection failed: ${reason}` : error.message);
        }
    })();
    const operation = pending;
    try { await operation; }
    finally { if (pending === operation) pending = null; }
}

async function waitForWorker(predicate, timeoutMessage) {
    const attempt = generation;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        if (attempt !== generation) throw new Error('Connection cancelled.');
        if (connectionError || scanError) throw new Error(connectionError || scanError);
        if (status && Date.now() - updatedAt < 5000 && predicate(status)) return status;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(timeoutMessage);
}

async function start(stream) {
    await connect('publisher');
    // Confirm readiness from the worker heartbeat, without a separate RPC exchange.
    const ready = await waitForWorker(() => true, 'Processor offline. Start the worker with npm run worker on your Mac or VPS.');
    if (!ready.worker?.ready) throw new Error('SmartSpectra is not configured on the processor.');
    if (ready.transport?.publisherIdentity) throw new Error('Another camera is scanning. Stop it first.');
    const candidate = room;
    const attempt = generation;
    track = new LocalVideoTrack(stream.getVideoTracks()[0]);
    await candidate.localParticipant.publishTrack(track, {
        source: Track.Source.Camera, simulcast: false, videoCodec: 'h264',
        videoEncoding: { maxBitrate: 4000000, maxFramerate: 30 },
        degradationPreference: 'maintain-framerate',
    });
    if (attempt !== generation) throw new Error('Scan cancelled.');
    announce('Camera connected; preparing measurements');
    const video = document.getElementById('camera');
    let previous;
    const measure = (now, metadata) => {
        if (!track || attempt !== generation) return;
        if (previous && now - previous.now >= 1000) {
            captureFps = (metadata.presentedFrames - previous.frames) * 1000 / (now - previous.now);
            void candidate.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ fps: captureFps })),
                { reliable: false, topic: 'capture-fps' }).catch(() => {});
            previous = { now, frames: metadata.presentedFrames };
        } else if (!previous) previous = { now, frames: metadata.presentedFrames };
        captureCallback = video.requestVideoFrameCallback(measure);
    };
    if (video.requestVideoFrameCallback) captureCallback = video.requestVideoFrameCallback(measure);
    await waitForWorker(value => value.transport?.publisherIdentity === candidate.localParticipant.identity,
        'The worker did not receive camera video. Check your connection and try again.');
}

async function disconnect() {
    generation++;
    tokenRequest?.abort();
    tokenRequest = null;
    document.getElementById('camera').cancelVideoFrameCallback?.(captureCallback);
    if (track) { track.stop(); track = null; }
    const old = room;
    room = null;
    status = null;
    updatedAt = 0;
    captureFps = null;
    pending = null;
    connectionError = null;
    scanError = null;
    if (old) await old.disconnect();
}

window.vitalLivekit = {
    connect, start, disconnect,
    getStatus() {
        if (connectionError || scanError) throw new Error(connectionError || scanError);
        if (!room || room.state !== 'connected') throw new Error('Not connected');
        if (!status || Date.now() - updatedAt > 5000) throw new Error('Processor offline. Start the worker with npm run worker on your Mac or VPS.');
        return status;
    },
    get captureFps() { return captureFps; },
};
