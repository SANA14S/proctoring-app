import { useEffect, useRef, useState } from 'react'
import './App.css'
import * as camUtils from "@mediapipe/camera_utils";
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import * as tf from '@tensorflow/tfjs'
import * as blazeface from '@tensorflow-models/blazeface'
import { Toaster, toast } from 'sonner'


type EventItem = { time: string; type: string; detail?: string }

type BlazePrediction = blazeface.NormalizedFace

const API_BASE = 'http://localhost:4000'

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
 const cameraRef = useRef<any>(null) 

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  const [faceCount, setFaceCount] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  console.log(status);
  const [events, setEvents] = useState<EventItem[]>([])
  const pendingToSendRef = useRef<EventItem[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const [sessionIdState, setSessionIdState] = useState<string | null>(null)
  const [currentStatus, setCurrentStatus] = useState<string>('Initializing')

  const [performanceMode, setPerformanceMode] = useState(true)
  const [objectsEnabled, setObjectsEnabled] = useState(false)

  const lastFaceSeenAtRef = useRef<number>(Date.now())
  const noFaceLoggedRef = useRef(false)
  const prevFaceCountRef = useRef<number>(0)

  const lookingAwayRef = useRef(false)
  const lookingAwaySinceRef = useRef<number | null>(null)
  const yawAvgRef = useRef<number>(0)

  const cocoModelRef = useRef<cocoSsd.ObjectDetection | null>(null)
  const blazeModelRef = useRef<blazeface.BlazeFaceModel | null>(null)
  const lastObjectEventAtRef = useRef<number>(0)
  const odCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const frameCountRef = useRef<number>(0)

  async function createSession(): Promise<string | null> {
    try {
      const resp = await fetch(`${API_BASE}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateName: 'Candidate' }) })
      const data = await resp.json()
      sessionIdRef.current = data.sessionId
      setSessionIdState(data.sessionId)
      localStorage.setItem('sessionId', data.sessionId)
      // enqueue session-start and flush immediately
      const startEvent = { time: new Date().toISOString(), type: 'session-start' as const }
      pendingToSendRef.current.push(startEvent)
      await flushPending()
      return data.sessionId
    } catch (e) { console.warn('Failed to create session', e); return null }
  }

  async function ensureSession(): Promise<string | null> {
    if (sessionIdRef.current) return sessionIdRef.current
    const saved = localStorage.getItem('sessionId')
    if (saved) {
      sessionIdRef.current = saved
      setSessionIdState(saved)
      return saved
    }
    return await createSession()
  }

  async function flushPending() {
    const sid = await ensureSession()
    if (!sid) return
    if (pendingToSendRef.current.length === 0) return
    const batch = pendingToSendRef.current.splice(0, pendingToSendRef.current.length)
    try {
      const resp = await fetch(`${API_BASE}/api/session/${sid}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }) })
      if (resp.status === 404) {
        // session lost on server, recreate and retry once
        const newsid = await createSession()
        if (!newsid) { pendingToSendRef.current.unshift(...batch); return }
        await fetch(`${API_BASE}/api/session/${newsid}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }) })
      }
    } catch (e) {
      pendingToSendRef.current.unshift(...batch)
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: performanceMode
            ? { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 12, max: 12 } }
            : { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 24 } },
          audio: true,
        })
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
          videoRef.current.muted = true
          ;(videoRef.current as any).playsInline = true
        }
      } catch (err) {
        console.error('Error accessing media devices', err)
        alert('Please allow camera and microphone access to proceed.')
        return
      }

      try {
        // Force TF.js CPU backend
        try {
          await tf.setBackend('cpu')
          await tf.ready()
        } catch (e) {
          console.warn('Failed to set TFJS CPU backend, continuing with default', e)
        }
        // Load models lazily
        blazeModelRef.current = await blazeface.load({ maxFaces: 2 })
        if (objectsEnabled && !cocoModelRef.current) {
          cocoModelRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' })
          console.log("✅ Object Detection model loaded");

        }

        odCanvasRef.current = document.createElement('canvas')
        odCanvasRef.current.width = performanceMode ? 256 : 320
        odCanvasRef.current.height = performanceMode ? 192 : 240

        if (videoRef.current) {
          const cam = new camUtils.Camera(videoRef.current, {
            onFrame: async () => {
              if (!videoRef.current) return

              // Face detection (BlazeFace) throttled
              frameCountRef.current++
              const faceEvery = performanceMode ? 4 : 2
              if (frameCountRef.current % faceEvery === 0 && blazeModelRef.current) {
                const preds = (await blazeModelRef.current.estimateFaces(videoRef.current, false)) as BlazePrediction[]
                const detections = preds || []
                setFaceCount(detections.length)

                // Transition-based logging
                const prevCount = prevFaceCountRef.current
                if (prevCount === 0 && detections.length >= 1) {
                  setEvents((prev) => [...prev, { time: new Date().toLocaleTimeString(), type: 'face-found' }])
                  pendingToSendRef.current.push({ time: new Date().toISOString(), type: 'face-found' })
                  toast.success('Face detected')
                }
                if (prevCount <= 1 && detections.length > 1) {
                  setEvents((prev) => [...prev, { time: new Date().toLocaleTimeString(), type: 'multiple-faces' }])
                  pendingToSendRef.current.push({ time: new Date().toISOString(), type: 'multiple-faces' })
                  toast.warning('Multiple faces detected')
                }
                prevFaceCountRef.current = detections.length

                // Draw to canvas
                const canvas = canvasRef.current
                const video = videoRef.current
                if (canvas && video) {
                  const ctx = canvas.getContext('2d')!
                  canvas.width = video.videoWidth
                  canvas.height = video.videoHeight
                  ctx.save()
                  ctx.clearRect(0, 0, canvas.width, canvas.height)
                  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                  let currStatus = 'No face'
                  console.log(currStatus);
                  if (detections.length > 0) {
                    lastFaceSeenAtRef.current = Date.now()
                    noFaceLoggedRef.current = false
                    if (detections.length > 1) {
                      currStatus = 'Multiple faces'
                    } else {
                      const det = detections[0]
                     let xMin = 0, yMin = 0, xMax = 0, yMax = 0;

if (det.topLeft && det.bottomRight) {
  if (Array.isArray(det.topLeft) && Array.isArray(det.bottomRight)) {
    // Normal array case
    yMin = det.topLeft[1];
    xMin = det.topLeft[0];
    yMax = det.bottomRight[1];
    xMax = det.bottomRight[0];
  } else {
    // Tensor case
    const tl = (det.topLeft as tf.Tensor1D).arraySync() as [number, number];
    const br = (det.bottomRight as tf.Tensor1D).arraySync() as [number, number];
    yMin = tl[1];
    xMin = tl[0];
    yMax = br[1];
    xMax = br[0];
  }
}
                      const bboxW = Math.max(1, xMax - xMin)
                      const faceCenterX = (xMin + xMax) / 2
                      // BlazeFace provides 6 landmarks: [rightEye, leftEye, nose, mouth, rightEar, leftEar]
                      let eyeCenterX = faceCenterX
                      // @ts-ignore
                      if (det.landmarks && det.landmarks.length >= 2) {
                        // @ts-ignore
                        const rightEye = det.landmarks[0]
                        // @ts-ignore
                        const leftEye = det.landmarks[1]
                        eyeCenterX = (rightEye[0] + leftEye[0]) / 2
                      }
                      // Normalized offset of eyes vs face center, relative to bbox width
                      const offsetFrac = (eyeCenterX - faceCenterX) / bboxW // ~[-0.5,0.5]
                      // Smooth with EMA to reduce flicker
                      yawAvgRef.current = 0.8 * yawAvgRef.current + 0.2 * offsetFrac
                      const absOffset = Math.abs(yawAvgRef.current)
                      const lookingAway = absOffset > 0.12 // ~12% of face width
                      if (lookingAway && !lookingAwayRef.current) {
                        lookingAwayRef.current = true
                        lookingAwaySinceRef.current = Date.now()
                      }
                      if (!lookingAway && lookingAwayRef.current) {
                        lookingAwayRef.current = false
                        lookingAwaySinceRef.current = null
                      }
                      if (lookingAwayRef.current && lookingAwaySinceRef.current) {
                        const elapsed = Date.now() - lookingAwaySinceRef.current
                        if (elapsed > 5000) {
                          setEvents((prev) => {
                            const last = prev[prev.length - 1]
                            if (!last || last.type !== 'focus-away-5s') {
                              return [
                                ...prev,
                                { time: new Date().toLocaleTimeString(), type: 'focus-away-5s', detail: `eye-offset≈${(absOffset*100).toFixed(0)}%` },
                              ]
                            }
                            return prev
                          })
                          pendingToSendRef.current.push({ time: new Date().toISOString(), type: 'focus-away-5s', detail: `eye-offset≈${(absOffset*100).toFixed(0)}%` })
                          toast('Looking away >5s', { description: `Offset ${(absOffset*100).toFixed(0)}%` })
                        }
                      }
                     
                      const currStatus = lookingAwayRef.current ? 'Looking away' : 'Focused'
                      setCurrentStatus(currStatus)
                      // Box
                      const w = xMax - xMin
                      const h = yMax - yMin
                      ctx.strokeStyle = '#00FF00'
                      ctx.lineWidth = 2
                      ctx.strokeRect(xMin, yMin, w, h)
                      ctx.fillStyle = '#000a'
                      ctx.fillRect(8, 8, 300, 26)
                      ctx.fillStyle = '#fff'
                      ctx.fillText(`faces: ${detections.length} • perf:${performanceMode ? 'on' : 'off'} • objs:${objectsEnabled ? 'on' : 'off'} • ${currStatus}`, 14, 26)
                    }
                  } else {
                    const msSince = Date.now() - lastFaceSeenAtRef.current
                    setCurrentStatus('No face')
                    if (msSince > 10000 && !noFaceLoggedRef.current) {
                      noFaceLoggedRef.current = true
                      setEvents((prev) => [
                        ...prev,
                        { time: new Date().toLocaleTimeString(), type: 'absence-10s', detail: 'No face for >10s' },
                      ])
                      pendingToSendRef.current.push({ time: new Date().toISOString(), type: 'absence-10s', detail: 'No face for >10s' })
                      toast.error('No face for >10s')
                    }
                  }

                  ctx.restore()
                }
              }


              // Object detection if enabled and not recording
              

              if (!isRecording && objectsEnabled && cocoModelRef.current && odCanvasRef.current) {
  const now = Date.now()
  const interval = performanceMode ? 3500 : 1200
  if (now - lastObjectEventAtRef.current > interval) {
    lastObjectEventAtRef.current = now

    const ctx = odCanvasRef.current.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(videoRef.current, 0, 0, odCanvasRef.current.width, odCanvasRef.current.height)

    const preds = await cocoModelRef.current.detect(odCanvasRef.current)
    const interesting = preds.filter(p =>
      ['cell phone', 'book', 'laptop', 'keyboard', 'mouse', 'bottle', 'charger', 'camera'].includes(p.class)
      && p.score > 0.8
    )

    if (interesting.length > 0) {
      const labels = Array.from(new Set(interesting.map(p => p.class))).join(', ')
      setEvents(prev => {
        const last = prev[prev.length - 1]
        if (!last || last.type !== 'object-detected' || last.detail !== labels) {
          return [...prev, { time: new Date().toLocaleTimeString(), type: 'object-detected', detail: labels }]
        }
        return prev
      })
      pendingToSendRef.current.push({ time: new Date().toISOString(), type: 'object-detected', detail: labels })
    }
  }
}

            },
          })
          cameraRef.current = cam
          setStatus('Ready')
          await cam.start()
        }
      } catch (e) {
        console.error('Failed to init models', e)
        setStatus('Models failed to load')
      }
    }
    init()

    return () => {
      if (cameraRef.current) {
        try { cameraRef.current.stop() } catch {}
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
      }
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performanceMode, objectsEnabled])

  useEffect(() => {
    const interval = setInterval(() => { void flushPending() }, 5000)
    return () => clearInterval(interval)
  }, [])

  const startRecording = () => {
    if (!stream) return

    recordedChunksRef.current = []
    const options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp9,opus' }
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, options)
    } catch (e) {
      recorder = new MediaRecorder(stream)
    }

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        recordedChunksRef.current.push(e.data)
      }
    }

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      setDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
    }

    recorder.start(1000)
    mediaRecorderRef.current = recorder
    setIsRecording(true)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  const downloadCsv = () => {
    const header = 'time,type,detail\n'
    const rows = events.map(e => `${e.time},${e.type},${(e.detail||'').replace(/[,\n]/g,' ')}`).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `proctoring-events-${Date.now()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <Toaster richColors position="top-center" />
      <h2>Interview Screen</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ padding: '4px 8px', borderRadius: 999, background: currentStatus === 'Focused' ? '#16a34a' : currentStatus === 'Looking away' ? '#f59e0b' : '#dc2626', color: '#fff' }}>
          {currentStatus}
        </span>
        <span style={{ padding: '4px 8px', borderRadius: 999, background: faceCount > 1 ? '#f59e0b' : '#334155', color: '#fff' }}>
          faces: {faceCount}
        </span>
        <span style={{ padding: '4px 8px', borderRadius: 999, background: performanceMode ? '#0ea5e9' : '#64748b', color: '#fff' }}>
          perf: {performanceMode ? 'on' : 'off'}
        </span>
        <span style={{ padding: '4px 8px', borderRadius: 999, background: objectsEnabled ? '#0ea5e9' : '#64748b', color: '#fff' }}>
          objects: {objectsEnabled ? 'on' : 'off'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label><input type="checkbox" checked={performanceMode} onChange={(e) => setPerformanceMode(e.target.checked)} /> Performance mode</label>
        <label><input type="checkbox" checked={objectsEnabled} onChange={(e) => setObjectsEnabled(e.target.checked)} /> Object detection</label>
        <button onClick={downloadCsv}>Download CSV</button>
        {sessionIdState && (
          <>
            <a href={`${API_BASE}/api/session/${sessionIdState}/report.csv`} target="_blank" rel="noreferrer">Report CSV</a>
            <a href={`${API_BASE}/api/session/${sessionIdState}/report.pdf`} target="_blank" rel="noreferrer">Report PDF</a>
          </>
        )}
      </div>

      <div style={{ position: 'relative', width: '100%', maxHeight: 500 }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', maxHeight: 500, background: '#000', borderRadius: 8, display: 'none' }}
        />
        <canvas ref={canvasRef} style={{ width: '100%', maxHeight: 500, borderRadius: 8 }} />
        <div style={{ position: 'absolute', top: 8, left: 8, padding: '4px 8px', background: '#000a', color: '#fff', borderRadius: 6 }}>
          faces: {faceCount}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={startRecording} disabled={isRecording || !stream}>Start Recording</button>
        <button onClick={stopRecording} disabled={!isRecording}>Stop Recording</button>
        {downloadUrl && (
          <a href={downloadUrl} download={`interview-${Date.now()}.webm`}>
            Download Recording
          </a>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <b>Event Log</b>
        <ul>
          {events.map((e, idx) => (
            <li key={idx}>{e.time}: {e.type}{e.detail ? ` — ${e.detail}` : ''}</li>
          ))}
        </ul>
      </div>

      <small>Tip: Turn on Performance mode if the camera lags. Enable Object detection only when needed.</small>
    </div>
  )
}

export default App
