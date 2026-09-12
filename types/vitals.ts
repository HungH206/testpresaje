export type LiveKitRole = 'publisher' | 'dashboard';

export type WorkerTransportStatus = {
    publisherIdentity: string | null;
    phase: 'idle' | 'warming' | 'measuring' | 'error' | string;
    captureFps: number | null;
    receivedFps: number;
    acceptedFps: number;
    error: string | null;
    timestampSource: string;
};

export type HrvSample = {
    rmssd: number | null;
    meanNn: number | null;
    sdnn: number | null;
    baevsky: number | null;
    timestamp: number | null;
    confidence: number | null;
    stable: boolean;
};

export type VitalsSnapshot = {
    breathingRate?: number;
    breathingConfidence?: number;
    faceExpression?: string;
    faceExpressionConfidence?: number;
    faceLandmarkCount?: number;
    blinking?: boolean;
    talking?: boolean;
    pulseRate?: number;
    pulseConfidence?: number;
    arterialPressureTrace?: number;
    arterialPressureConfidence?: number;
    hrv?: HrvSample;
};

export type SdkStatus = {
    available: boolean;
    nativeSessionEnabled: boolean;
    sessionActive: boolean;
    sessionStartedAt: string | null;
    activeSource: 'camera' | 'file' | 'custom' | null;
    requestedMetricCount: number;
    requestedBundles: string[];
    metricsPacketCount: number;
    latestVitals: VitalsSnapshot | null;
    transport?: WorkerTransportStatus;
    worker?: { ready: boolean };
    lastError?: { message: string; retryable: boolean } | null;
    validationStatus?: { hint?: string; code?: number } | null;
};
