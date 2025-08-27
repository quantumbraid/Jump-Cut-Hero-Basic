import React from 'react';

interface VideoPreviewProps {
    stream: MediaStream | null;
    videoUrl: string | null;
    isRecording: boolean;
    isMirrored: boolean;
    orientation: 'landscape' | 'portrait';
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ stream, videoUrl, isRecording, isMirrored, orientation }) => {
    const videoRef = React.useRef<HTMLVideoElement>(null);

    React.useEffect(() => {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        if (videoUrl) {
            // Switch to playback mode
            videoElement.srcObject = null;
            videoElement.src = videoUrl;
            videoElement.muted = false;
            videoElement.controls = true;
            videoElement.classList.remove('scale-x-[-1]'); // Always un-mirror for playback
            videoElement.load(); // Explicitly load the new source
            videoElement.play().catch(error => {
                console.log("Playback failed, user interaction may be required.", error);
            });
        } else if (stream) {
            // Switch to live preview mode
            videoElement.src = '';
            videoElement.srcObject = stream;
            videoElement.muted = true;
            videoElement.controls = false;
            // Apply mirroring based on prop
            if (isMirrored) {
                videoElement.classList.add('scale-x-[-1]');
            } else {
                videoElement.classList.remove('scale-x-[-1]');
            }
            videoElement.play().catch(error => {
                console.log("Stream preview failed to play.", error);
            });
        } else {
             // Clean up if no source
             videoElement.srcObject = null;
             videoElement.src = '';
             videoElement.controls = false;
        }
    }, [stream, videoUrl, isMirrored]);

    const aspectClass = orientation === 'landscape' ? 'aspect-video' : 'aspect-[9/16]';
    const baseClasses = 'w-full rounded-lg shadow-2xl bg-black transition-all duration-300';
    const borderClass = isRecording ? 'ring-4 ring-red-500 ring-offset-4 ring-offset-gray-900' : 'ring-2 ring-gray-700';
    
    // Using object-contain to ensure the full video is visible.
    const videoClasses = "w-full h-full object-contain rounded-lg";

    return (
        <div className={`${aspectClass} ${baseClasses} ${borderClass}`}>
            <video
                ref={videoRef}
                playsInline
                className={videoClasses}
            />
        </div>
    );
};

export default VideoPreview;