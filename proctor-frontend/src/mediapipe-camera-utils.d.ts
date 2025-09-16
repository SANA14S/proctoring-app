declare module '@mediapipe/camera_utils/camera_utils' {
  export class Camera {
    constructor(videoElement: HTMLVideoElement, options: { onFrame: () => void; width?: number; height?: number });
    start(): Promise<void>;
    stop(): void;
  }
}
