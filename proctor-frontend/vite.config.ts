import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
    host: true,
  },
  resolve: {
    alias: {
      '@mediapipe/camera_utils': 'node_modules/@mediapipe/camera_utils/camera_utils.js',
      '@mediapipe/face_detection': 'node_modules/@mediapipe/face_detection/face_detection.js',
      '@mediapipe/drawing_utils': 'node_modules/@mediapipe/drawing_utils/drawing_utils.js',
      '@mediapipe/control_utils': 'node_modules/@mediapipe/control_utils/control_utils.js',
    }
  }
})
