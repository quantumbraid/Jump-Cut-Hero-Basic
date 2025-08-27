
import React from 'react';
import { RecordingState } from '../types';
import { Icon } from './Icon';

interface StatusIndicatorProps {
  state: RecordingState;
  calibrationCountdown: number;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ state, calibrationCountdown }) => {
  const getStatusContent = (): { icon?: React.ReactNode, text: string, color: string } => {
    switch (state) {
      case RecordingState.CALIBRATING:
        return {
          text: `Calibrating... Be silent. (${Math.ceil(calibrationCountdown / 1000)}s)`,
          color: 'bg-yellow-500',
        };
      case RecordingState.RECORDING:
        return {
          icon: <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse"></div>,
          text: 'Recording',
          color: 'bg-red-600',
        };
      case RecordingState.PAUSED:
        return {
          icon: <Icon icon="pause" className="w-4 h-4"/>,
          text: 'Paused',
          color: 'bg-blue-500',
        };
      case RecordingState.STOPPED:
        return {
          text: 'Finished! Your video is ready.',
          color: 'bg-green-500',
        };
      case RecordingState.IDLE:
      default:
        return {
          text: 'Ready to Record',
          color: 'bg-gray-600',
        };
    }
  };

  const { icon, text, color } = getStatusContent();
  
  if (state === RecordingState.IDLE) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
      <div className={`flex items-center space-x-2 px-4 py-2 rounded-full text-sm font-semibold shadow-lg ${color} text-white`}>
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
};

export default StatusIndicator;
