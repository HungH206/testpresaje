import { Room, RoomEvent, LocalVideoTrack, Track, DisconnectReason, ConnectionErrorReason } from 'livekit-client';

let room;
let track;
let status;
let updatedAt = 0;
let role;
let captureCallback;
let captureFps = 0;
let connectionError = null;

async function connect(nextRole) {
    if (room && role === nextRole && room.state === 'connected') return;
    await disconnect();
    connectionError = null;
    const response = await fetch('/api/livekit/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole, accessCode: document.getElementById('livekitCode').value }),
    });
    const credentials = await response.json();
    if (!response.ok) throw new Error(credentials.error);
    role = nextRole;
    room = new Room({ adaptiveStream: false, dynacast: false });
    room.on(RoomEvent.DataReceived, (data, participant, _kind, topic) => {
        if (participant?.identity !== 'processor' || topic !== 'vitals') return;
        try { status = JSON.parse(new TextDecoder().decode(data)); updatedAt = Date.now(); }
        catch { /* Ignore malformed packets. */ }
    });
    room.on(RoomEvent.Disconnected, (reason) => {
        status = null; updatedAt = 0;
        connectionError = `LiveKit disconnected: ${DisconnectReason[reason] || 'unknown reason'}`;
        if (track) window.dispatchEvent(new Event('livekit-lost'));
    });
    try { await room.connect(credentials.url, credentials.token); }
    catch (error) {
        const reason = error.reason === ConnectionErrorReason.LeaveRequest
            ? DisconnectReason[error.context]
            : error.reasonName;
        await disconnect();
        connectionError = `LiveKit connection failed: ${reason || 'network or signaling failure'}`;
        throw new Error(connectionError);
    }
}

async function start(stream) {
    await connect('publisher');
    await room.localParticipant.performRpc({ destinationIdentity: 'processor', method: 'ready', payload: '', responseTimeout: 10 });
    track = new LocalVideoTrack(stream.getVideoTracks()[0]);
    await room.localParticipant.publishTrack(track, {
        source: Track.Source.Camera, simulcast: false, videoCodec: 'h264',
        videoEncoding: { maxBitrate: 4000000, maxFramerate: 30 },
        degradationPreference: 'maintain-framerate',
    });
    const video = document.getElementById('camera');
    let previous;
    const measure = (now, metadata) => {
        if (!track) return;
        if (previous && now - previous.now >= 1000) {
            captureFps = (metadata.presentedFrames - previous.frames) * 1000 / (now - previous.now);
            void room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ fps: captureFps })),
                { reliable: false, topic: 'capture-fps' }).catch(() => {});
            previous = { now, frames: metadata.presentedFrames };
        } else if (!previous) previous = { now, frames: metadata.presentedFrames };
        captureCallback = video.requestVideoFrameCallback(measure);
    };
    if (video.requestVideoFrameCallback) captureCallback = video.requestVideoFrameCallback(measure);
}

async function disconnect() {
    document.getElementById('camera').cancelVideoFrameCallback?.(captureCallback);
    if (track) { track.stop(); track = null; }
    if (room) { const old = room; room = null; await old.disconnect(); }
    status = null;
    updatedAt = 0;
    captureFps = 0;
}

window.vitalLivekit = {
    connect, start, disconnect,
    getStatus() {
        if (connectionError) throw new Error(connectionError);
        if (!room || room.state !== 'connected') throw new Error('Dashboard is not connected to LiveKit');
        if (!status || Date.now() - updatedAt > 5000) throw new Error('LiveKit connected; waiting for Mac worker');
        return status;
    },
    get captureFps() { return captureFps; },
};
