import React, { useState, useRef, useCallback, useEffect } from 'react';
import { RecordingState } from './types';
import { CALIBRATION_TIME_MS, SILENCE_DETECTION_TIME_MS, THRESHOLD_MULTIPLIER, FFT_SIZE } from './constants';
import VideoPreview from './components/VideoPreview';
import StatusIndicator from './components/StatusIndicator';
import { Icon } from './components/Icon';

const App: React.FC = () => {
    const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [calibrationCountdown, setCalibrationCountdown] = useState<number>(CALIBRATION_TIME_MS);

    // New state for settings
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [isMirrored, setIsMirrored] = useState<boolean>(true);
    const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
    const [hasPermissions, setHasPermissions] = useState(false);

    const streamRef = useRef<MediaStream | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const silenceThresholdRef = useRef<number>(0);
    const animationFrameRef = useRef<number>(0);
    
    const getDevices = useCallback(async () => {
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
            setDevices(videoDevices);
        } catch (err) {
            console.error("Could not enumerate devices:", err);
        }
    }, []);

    useEffect(() => {
        getDevices();
        navigator.mediaDevices.addEventListener('devicechange', getDevices);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', getDevices);
        };
    }, [getDevices]);

    useEffect(() => {
        // If no device is selected, or the selected one is gone, select the first available.
        if (devices.length > 0 && !devices.some(d => d.deviceId === selectedDeviceId)) {
            setSelectedDeviceId(devices[0].deviceId);
        }
    }, [devices, selectedDeviceId]);

    // Re-fetch devices with labels after permissions are granted
    useEffect(() => {
        if (hasPermissions) {
            getDevices();
        }
    }, [hasPermissions, getDevices]);

    const cleanup = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
    }, []);

    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);

    const runAudioAnalysis = useCallback(() => {
        if (!analyserRef.current || recordingState === RecordingState.CALIBRATING) {
            animationFrameRef.current = requestAnimationFrame(runAudioAnalysis);
            return;
        };

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const averageVolume = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        const isSilent = averageVolume < silenceThresholdRef.current * THRESHOLD_MULTIPLIER;
        
        if (mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state === 'recording' && isSilent) {
                if (!silenceTimerRef.current) {
                    silenceTimerRef.current = setTimeout(() => {
                        if (mediaRecorderRef.current?.state === 'recording') {
                             mediaRecorderRef.current.pause();
                             setRecordingState(RecordingState.PAUSED);
                        }
                    }, SILENCE_DETECTION_TIME_MS);
                }
            } else if (mediaRecorderRef.current.state === 'recording' && !isSilent) {
                 if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
            } else if (mediaRecorderRef.current.state === 'paused' && !isSilent) {
                mediaRecorderRef.current.resume();
                setRecordingState(RecordingState.RECORDING);
            }
        }
        
        animationFrameRef.current = requestAnimationFrame(runAudioAnalysis);
    }, [recordingState]);

    // FIX: Moved `startActualRecording` before `startCalibration` to resolve the "used before its declaration" error.
    const startActualRecording = useCallback(() => {
        if (!streamRef.current) return;
        setRecordingState(RecordingState.RECORDING);

        const options = { mimeType: 'video/webm; codecs=vp9' };
        mediaRecorderRef.current = new MediaRecorder(streamRef.current, options);

        mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunksRef.current.push(event.data);
            }
        };

        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
            cleanup();
        };
        
        mediaRecorderRef.current.start(1000); // Trigger dataavailable every second
        runAudioAnalysis();

    }, [cleanup, runAudioAnalysis]);

    const startCalibration = useCallback(async () => {
        setRecordingState(RecordingState.CALIBRATING);
        setError(null);
        setVideoUrl(null);
        recordedChunksRef.current = [];
        
        const videoConstraints: MediaTrackConstraints = {
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
        };
        if (orientation === 'landscape') {
            videoConstraints.aspectRatio = { ideal: 16 / 9 };
            videoConstraints.width = { ideal: 1280 };
            videoConstraints.height = { ideal: 720 };
        } else {
            videoConstraints.aspectRatio = { ideal: 9 / 16 };
            videoConstraints.width = { ideal: 720 };
            videoConstraints.height = { ideal: 1280 };
        }

        try {
            streamRef.current = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
            if (!hasPermissions) {
                setHasPermissions(true);
            }

            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = FFT_SIZE;
            source.connect(analyserRef.current);

            const calibrationData: number[] = [];
            setCalibrationCountdown(CALIBRATION_TIME_MS);
            const countdownInterval = setInterval(() => {
                setCalibrationCountdown(prev => prev - 100);
            }, 100);

            const collectCalibrationData = () => {
                if (audioContextRef.current && analyserRef.current && audioContextRef.current.state === 'running') {
                    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
                    analyserRef.current.getByteFrequencyData(dataArray);
                    const averageVolume = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                    calibrationData.push(averageVolume);
                }
            };
            
            const collectionInterval = setInterval(collectCalibrationData, 50);

            setTimeout(() => {
                clearInterval(collectionInterval);
                clearInterval(countdownInterval);
                if (calibrationData.length > 0) {
                    const average = calibrationData.reduce((a, b) => a + b, 0) / calibrationData.length;
                    silenceThresholdRef.current = average > 0 ? average : 1; // Avoid threshold of 0
                } else {
                    silenceThresholdRef.current = 1; // Default fallback
                }

                startActualRecording();

            }, CALIBRATION_TIME_MS);

        } catch (err) {
            if ((err as Error).name === 'OverconstrainedError') {
                setError(`The selected camera does not support ${orientation} orientation. Please try another setting or camera.`);
            } else {
                setError('Could not access camera/microphone. Please check permissions.');
            }
            setRecordingState(RecordingState.IDLE);
            cleanup();
        }
    }, [cleanup, hasPermissions, orientation, selectedDeviceId, startActualRecording]);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && recordingState !== RecordingState.IDLE && recordingState !== RecordingState.STOPPED) {
            mediaRecorderRef.current.stop();
            setRecordingState(RecordingState.STOPPED);
        }
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    }, [recordingState]);
    
    const handleReset = () => {
        setRecordingState(RecordingState.IDLE);
        setVideoUrl(null);
        setError(null);
        cleanup();
    }
    
    const renderControls = () => {
        switch(recordingState){
            case RecordingState.IDLE:
                return <button onClick={startCalibration} className="bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="record" className="w-6 h-6" /><span>Start Recording</span></button>;
            case RecordingState.CALIBRATING:
                return <button disabled className="bg-yellow-500 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg cursor-not-allowed"><div className="w-6 h-6 border-t-2 border-white rounded-full animate-spin"></div><span>Calibrating...</span></button>;
            case RecordingState.RECORDING:
            case RecordingState.PAUSED:
                return <button onClick={stopRecording} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="stop" className="w-6 h-6" /><span>Stop Recording</span></button>;
            case RecordingState.STOPPED:
                return (
                    <div className="flex space-x-4">
                        <a href={videoUrl!} download="jump-cut-hero-video.webm" className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><Icon icon="download" className="w-6 h-6"/><span>Download Video</span></a>
                        <button onClick={handleReset} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-4 px-8 rounded-full flex items-center space-x-3 text-lg transition-transform transform hover:scale-105 shadow-lg"><span>Record Again</span></button>
                    </div>
                );
        }
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans">
            <header className="text-center mb-6">
                <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-red-500 to-yellow-400">Jump Cut Hero</span>
                </h1>
                <p className="mt-2 text-lg text-gray-400 max-w-2xl mx-auto">Record videos without silent gaps. No editing required.</p>
            </header>

            <main className="w-full max-w-4xl flex flex-col items-center">
                {recordingState === RecordingState.IDLE && (
                    <div className="w-full max-w-2xl mb-6 p-4 bg-gray-800/50 rounded-lg shadow-md border border-gray-700">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                            <div className="flex flex-col">
                                <label htmlFor="camera-select" className="text-sm font-medium text-gray-400 mb-2">Camera</label>
                                <select
                                    id="camera-select"
                                    value={selectedDeviceId}
                                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                                    disabled={devices.length === 0}
                                    className="bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block w-full p-2.5"
                                >
                                    {devices.length === 0 && <option>No cameras found</option>}
                                    {devices.map((device, index) => (
                                        <option key={device.deviceId} value={device.deviceId}>
                                            {device.label || `Camera ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                             <div className="flex flex-col">
                                <label className="text-sm font-medium text-gray-400 mb-2">Orientation</label>
                                <div className="flex w-full bg-gray-700 rounded-lg p-1">
                                    <button onClick={() => setOrientation('landscape')} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md transition ${orientation === 'landscape' ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Landscape</button>
                                    <button onClick={() => setOrientation('portrait')} className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md transition ${orientation === 'portrait' ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Portrait</button>
                                </div>
                            </div>
                            <div className="flex flex-col justify-center items-start md:items-center pt-2 md:pt-0 md:mt-6">
                                <label htmlFor="mirror-toggle" className="flex items-center cursor-pointer">
                                    <span className="mr-3 text-sm font-medium text-gray-300">Mirror Preview</span>
                                    <div className="relative">
                                        <input type="checkbox" id="mirror-toggle" className="sr-only peer" checked={isMirrored} onChange={() => setIsMirrored(!isMirrored)} />
                                        <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                )}
                <div className="w-full relative mb-6">
                     <StatusIndicator state={recordingState} calibrationCountdown={calibrationCountdown} />
                     <VideoPreview 
                        stream={streamRef.current} 
                        videoUrl={videoUrl} 
                        isRecording={recordingState === RecordingState.RECORDING}
                        isMirrored={isMirrored}
                        orientation={orientation}
                    />
                </div>
                {error && <p className="text-red-500 mb-4">{error}</p>}
                <div className="h-20 flex items-center justify-center">
                   {renderControls()}
                </div>
            </main>
            
            <footer className="text-center text-gray-500 mt-8 text-sm">
                <p>&copy; {new Date().getFullYear()} Jump Cut Hero. The smart way to record.</p>
            </footer>
        </div>
    );
};

export default App;