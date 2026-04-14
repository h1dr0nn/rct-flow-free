import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Arrow } from '../stores'
import { audio } from '../utils/audio'

interface GridCanvasProps {
    rows: number
    cols: number
    overlays: {
        arrows: Arrow[]
        obstacles: any[]
    }
    onArrowsUpdate: (arrows: Arrow[]) => void
    onWin?: () => void
    // View State
    zoom: number
    setZoom: (zoom: number) => void
    pan: { x: number, y: number }
    setPan: (pan: { x: number, y: number }) => void
    isZoomInitialized: boolean
    setIsZoomInitialized: (initialized: boolean) => void
    // March animation
    isMarching: boolean
    marchProgress: number  // 0..1
}

const CELL_SIZE = 60 // Larger for gameplay

export function GridCanvas({
    rows,
    cols,
    overlays,
    onArrowsUpdate,
    zoom,
    setZoom,
    pan,
    setPan,
    isZoomInitialized,
    setIsZoomInitialized,
    isMarching,
    marchProgress,
}: GridCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
    
    // Gameplay state
    const [activeArrowId, setActiveArrowId] = useState<number | null>(null)
    const [currentPath, setCurrentPath] = useState<{ row: number; col: number }[]>([])

    // Resize observer
    useLayoutEffect(() => {
        if (!containerRef.current) return
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect
                setCanvasSize({ width, height })
            }
        })
        resizeObserver.observe(containerRef.current)
        return () => resizeObserver.disconnect()
    }, [])

    // Fit to screen
    const fitToScreen = () => {
        if (canvasSize.width === 0 || canvasSize.height === 0) return
        const padding = 40
        const availableWidth = canvasSize.width - padding
        const availableHeight = canvasSize.height - padding
        const gridWidth = cols * CELL_SIZE
        const gridHeight = rows * CELL_SIZE
        const newZoom = Math.min(availableWidth / gridWidth, availableHeight / gridHeight, 1)
        setZoom(newZoom)
        setPan({
            x: (canvasSize.width - gridWidth * newZoom) / 2,
            y: (canvasSize.height - gridHeight * newZoom) / 2
        })
        setIsZoomInitialized(true)
    }

    useEffect(() => {
        if (canvasSize.width > 0 && !isZoomInitialized) {
            fitToScreen()
        }
    }, [canvasSize, cols, rows, isZoomInitialized])

    // Coordinate conversion
    const getGridCoords = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        let clientX, clientY
        if ('touches' in e) {
            clientX = e.touches[0].clientX
            clientY = e.touches[0].clientY
        } else {
            clientX = e.clientX
            clientY = e.clientY
        }
        const worldX = (clientX - rect.left - pan.x) / zoom
        const worldY = (clientY - rect.top - pan.y) / zoom
        const col = Math.floor(worldX / CELL_SIZE)
        const row = Math.floor(worldY / CELL_SIZE)
        return { row, col }
    }

    // Input handlers
    const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
        if (isMarching) return // no input during march animation
        const coords = getGridCoords(e)
        if (!coords) return
        if (coords.row < 0 || coords.row >= rows || coords.col < 0 || coords.col >= cols) return

        // Only allow drag from source (square) dot — not target (circle)
        let arrow = overlays.arrows.find(a =>
            a.row === coords.row && a.col === coords.col
        )

        if (arrow) {
            setActiveArrowId(arrow.id)
            setCurrentPath([{ row: coords.row, col: coords.col }])
            onArrowsUpdate(overlays.arrows.map(a =>
                a.id === arrow!.id ? { ...a, path: [{ row: coords.row, col: coords.col }], isCompleted: false } : a
            ))
            return
        }

        // Check if clicked on an existing path segment
        arrow = overlays.arrows.find(a => 
            a.path?.some(p => p.row === coords.row && p.col === coords.col)
        )

        if (arrow) {
            setActiveArrowId(arrow.id)
            // Truncate path up to this point
            const index = arrow.path?.findIndex(p => p.row === coords.row && p.col === coords.col) ?? -1
            if (index !== -1) {
                setCurrentPath(arrow.path!.slice(0, index + 1))
            }
        }
    }

    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (activeArrowId === null) return
        const coords = getGridCoords(e)
        if (!coords) return
        if (coords.row < 0 || coords.row >= rows || coords.col < 0 || coords.col >= cols) return

        const lastPoint = currentPath[currentPath.length - 1]
        if (coords.row === lastPoint.row && coords.col === lastPoint.col) return

        // Adjacency check
        const dr = Math.abs(coords.row - lastPoint.row)
        const dc = Math.abs(coords.col - lastPoint.col)
        if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
            // Check if loop back (undoing)
            if (currentPath.length > 1) {
                const prevPoint = currentPath[currentPath.length - 2]
                if (coords.row === prevPoint.row && coords.col === prevPoint.col) {
                    setCurrentPath(prev => prev.slice(0, -1))
                    return
                }
            }

            // Check if hitting another arrow's path -> truncate that arrow
            const collidingArrow = overlays.arrows.find(a => 
                a.id !== activeArrowId && 
                a.path?.some(p => p.row === coords.row && p.col === coords.col)
            )

            if (collidingArrow) {
                const index = collidingArrow.path!.findIndex(p => p.row === coords.row && p.col === coords.col)
                const newCollidingPath = collidingArrow.path!.slice(0, index)
                onArrowsUpdate(overlays.arrows.map(a => 
                    a.id === collidingArrow.id ? { ...a, path: newCollidingPath, isCompleted: false } : a
                ))
            }

            // Check if hitting own path -> loop back
            const selfIndex = currentPath.findIndex(p => p.row === coords.row && p.col === coords.col)
            if (selfIndex !== -1) {
                setCurrentPath(prev => prev.slice(0, selfIndex + 1))
                return
            }

            // Add point
            const newPath = [...currentPath, { row: coords.row, col: coords.col }]
            setCurrentPath(newPath)

            // Check if target reached (source→target only)
            const arrow = overlays.arrows.find(a => a.id === activeArrowId)!
            const reachedTarget = coords.row === arrow.targetRow && coords.col === arrow.targetCol
                && newPath[0].row === arrow.row && newPath[0].col === arrow.col

            if (reachedTarget && !arrow.isCompleted) {
                audio.playConnect()
            }

            onArrowsUpdate(overlays.arrows.map(a =>
                a.id === activeArrowId ? { ...a, path: newPath, isCompleted: reachedTarget } : a
            ))
        }
    }

    const handleEnd = () => {
        setActiveArrowId(prev => {
            if (prev === null) return null
            
            const arrow = overlays.arrows.find(a => a.id === prev)
            if (arrow && !arrow.isCompleted) {
                audio.playDisconnect()
                // As per user request "1. xoá": clear path if not completed
                onArrowsUpdate(overlays.arrows.map(a => 
                    a.id === prev ? { ...a, path: [{ row: a.row, col: a.col }], isCompleted: false } : a
                ))
            }
            return null
        })
        setCurrentPath([])
    }

    // Window listeners for global drag support
    useEffect(() => {
        if (activeArrowId === null) return

        const onWindowMove = (e: MouseEvent | TouchEvent) => {
            // Need to handle the event manually here since it's a window listener
            const coords = getGridCoords(e as any) 
            if (!coords) return
            
            // We still want to boundary check for logic, but not end the drag
            if (coords.row < 0 || coords.row >= rows || coords.col < 0 || coords.col >= cols) return
            
            // Re-use logic from handleMove but adapted for window event
            // (Shared logic could be extracted, but let's keep it simple for now)
            handleMove(e as any)
        }

        const onWindowUp = () => {
            handleEnd()
        }

        window.addEventListener('mousemove', onWindowMove)
        window.addEventListener('mouseup', onWindowUp)
        window.addEventListener('touchmove', onWindowMove, { passive: false })
        window.addEventListener('touchend', onWindowUp)

        return () => {
            window.removeEventListener('mousemove', onWindowMove)
            window.removeEventListener('mouseup', onWindowUp)
            window.removeEventListener('touchmove', onWindowMove)
            window.removeEventListener('touchend', onWindowUp)
        }
    }, [activeArrowId, currentPath, overlays.arrows]) // Dependencies ensure we have fresh state

    // Draw
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.translate(pan.x, pan.y)
        ctx.scale(zoom, zoom)

        // Draw grid
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = 2
        for (let r = 0; r <= rows; r++) {
            ctx.beginPath()
            ctx.moveTo(0, r * CELL_SIZE)
            ctx.lineTo(cols * CELL_SIZE, r * CELL_SIZE)
            ctx.stroke()
        }
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath()
            ctx.moveTo(c * CELL_SIZE, 0)
            ctx.lineTo(c * CELL_SIZE, rows * CELL_SIZE)
            ctx.stroke()
        }

        // Draw paths
        overlays.arrows.forEach(arrow => {
            if (!arrow.path || arrow.path.length < 1) return
            
            ctx.save()
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.lineWidth = CELL_SIZE * 0.4
            ctx.strokeStyle = arrow.color

            // Glow for completed
            if (arrow.isCompleted) {
                ctx.shadowBlur = 15
                ctx.shadowColor = arrow.color
            }

            ctx.beginPath()
            const startX = arrow.path[0].col * CELL_SIZE + CELL_SIZE / 2
            const startY = arrow.path[0].row * CELL_SIZE + CELL_SIZE / 2
            ctx.moveTo(startX, startY)
            for (let i = 1; i < arrow.path.length; i++) {
                ctx.lineTo(
                    arrow.path[i].col * CELL_SIZE + CELL_SIZE / 2,
                    arrow.path[i].row * CELL_SIZE + CELL_SIZE / 2
                )
            }
            ctx.stroke()
            ctx.restore()
        })

        // Draw dots — squares for source, circles for target
        overlays.arrows.forEach(arrow => {
            const drawCircle = (r: number, c: number) => {
                const x = c * CELL_SIZE + CELL_SIZE / 2
                const y = r * CELL_SIZE + CELL_SIZE / 2
                ctx.fillStyle = arrow.color
                ctx.beginPath()
                ctx.arc(x, y, CELL_SIZE * 0.35, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = 'rgba(255,255,255,0.25)'
                ctx.beginPath()
                ctx.arc(x - CELL_SIZE * 0.08, y - CELL_SIZE * 0.08, CELL_SIZE * 0.1, 0, Math.PI * 2)
                ctx.fill()
            }
            const drawSquare = (x: number, y: number) => {
                const s = CELL_SIZE * 0.3
                const r = s * 0.25 // corner radius
                ctx.fillStyle = arrow.color
                ctx.beginPath()
                ctx.roundRect(x - s, y - s, s * 2, s * 2, r)
                ctx.fill()
                ctx.fillStyle = 'rgba(255,255,255,0.25)'
                ctx.fillRect(x - s * 0.45, y - s * 0.45, s * 0.35, s * 0.35)
            }

            // Target — always circle at fixed position
            drawCircle(arrow.targetRow, arrow.targetCol)

            // Source — square, position depends on march state
            if (isMarching && arrow.path && arrow.path.length >= 2) {
                // Interpolate square position along path
                const t = marchProgress
                const maxIdx = arrow.path.length - 1
                const floatIdx = t * maxIdx
                const i0 = Math.min(Math.floor(floatIdx), maxIdx)
                const i1 = Math.min(i0 + 1, maxIdx)
                const frac = floatIdx - i0
                const fromCell = arrow.path[i0]
                const toCell = arrow.path[i1]
                const sx = ((1 - frac) * fromCell.col + frac * toCell.col) * CELL_SIZE + CELL_SIZE / 2
                const sy = ((1 - frac) * fromCell.row + frac * toCell.row) * CELL_SIZE + CELL_SIZE / 2
                drawSquare(sx, sy)
            } else {
                drawSquare(
                    arrow.col * CELL_SIZE + CELL_SIZE / 2,
                    arrow.row * CELL_SIZE + CELL_SIZE / 2,
                )
            }
        })

        ctx.restore()
    }, [overlays, rows, cols, zoom, pan, activeArrowId, currentPath, isMarching, marchProgress])

    return (
        <div ref={containerRef} className="w-full h-full relative cursor-crosshair touch-none">
            <canvas
                ref={canvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                onMouseDown={handleStart}
                onTouchStart={handleStart}
                // Global listeners handle move and end
            />
        </div>
    )
}
