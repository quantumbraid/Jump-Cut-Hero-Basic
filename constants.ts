
// How long the calibration period is in milliseconds.
export const CALIBRATION_TIME_MS = 3000;

// How long silence must be detected before pausing in milliseconds.
export const SILENCE_DETECTION_TIME_MS = 500;

// A multiplier for the silence threshold. Audio below this level is considered silence.
// A value of 1.8 means the audio level must be 80% louder than the calibrated room tone to be considered sound.
export const THRESHOLD_MULTIPLIER = 1.8;

// The size of the FFT (Fast Fourier Transform) for the audio analyser. Must be a power of 2.
export const FFT_SIZE = 256;