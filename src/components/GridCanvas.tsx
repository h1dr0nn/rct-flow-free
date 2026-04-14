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
    isWon?: boolean
    marchProgress: number  // 0..1
    maxLength?: number     // Longest path length for speed-based normalization
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
    isWon,
    marchProgress,
    maxLength = 1,
}: GridCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const handleMoveRef = useRef<((e: any) => void) | null>(null)
    const handleEndRef = useRef<(() => void) | null>(null)
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

            // Block movement if hitting any dot (source or target) of another color
            const isOtherDot = overlays.arrows.some(a => 
                a.id !== activeArrowId && (
                    (a.row === coords.row && a.col === coords.col) ||
                    (a.targetRow === coords.row && a.targetCol === coords.col)
                )
            )
            if (isOtherDot) return

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
        if (isMarching) {
            setActiveArrowId(null)
            setCurrentPath([])
            return
        }

        if (activeArrowId !== null) {
            const arrow = overlays.arrows.find(a => a.id === activeArrowId)
            if (arrow && !arrow.isCompleted) {
                audio.playDisconnect()
                onArrowsUpdate(overlays.arrows.map(a =>
                    a.id === activeArrowId ? { ...a, path: [{ row: a.row, col: a.col }], isCompleted: false } : a
                ))
            }
            setActiveArrowId(null)
        }
        setCurrentPath([])
    }

    // Keep refs pointing to latest handlers so window listeners never have stale closures
    handleMoveRef.current = handleMove
    handleEndRef.current = handleEnd

    // Window listeners for global drag support
    useEffect(() => {
        if (activeArrowId === null) return

        const onWindowMove = (e: MouseEvent | TouchEvent) => {
            handleMoveRef.current?.(e as any)
        }

        const onWindowUp = () => {
            handleEndRef.current?.()
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
    }, [activeArrowId]) // Refs keep handlers fresh; only re-register when drag starts/stops

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

        // Draw paths and dots
        overlays.arrows.forEach(arrow => {
            if (!arrow.path || arrow.path.length < 1) return

            // 1. Calculate animation position (floatIdx)
            // Use maxLength + buffer to ensure all arrows move at the same speed
            let floatIdx = 0
            let cellsCovered = 0
            if ((isMarching || isWon) && arrow.path.length >= 1) {
                // If won, force progress to 1 (final state)
                const globalProgress = isWon ? 1 : (isNaN(marchProgress) ? 0 : Math.max(0, Math.min(marchProgress, 1)))
                // Must match the 0.5 buffer added in App.tsx
                const totalAnimatedDistance = (maxLength - 1) + 0.5
                cellsCovered = globalProgress * totalAnimatedDistance
                floatIdx = Math.min(cellsCovered, arrow.path.length - 1)
            }

            const i0 = Math.floor(floatIdx)
            const i1 = Math.min(i0 + 1, arrow.path.length - 1)
            const frac = floatIdx - i0
            const fromCell = arrow.path[i0]
            const toCell = arrow.path[i1] || fromCell

            if (!fromCell) return

            // Current position of the source square
            const squareX = ((1 - frac) * fromCell.col + frac * toCell.col) * CELL_SIZE + CELL_SIZE / 2
            const squareY = ((1 - frac) * fromCell.row + frac * toCell.row) * CELL_SIZE + CELL_SIZE / 2

            // 2. Draw path (retract behind square)
            ctx.save()
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            ctx.lineWidth = CELL_SIZE * 0.4
            ctx.strokeStyle = arrow.color

            ctx.beginPath()
            // Start line from the current square position
            ctx.moveTo(squareX, squareY)
            // Draw remaining segments of the path ahead of the square
            for (let i = i1; i < arrow.path.length; i++) {
                const p = arrow.path[i]
                if (p) {
                    ctx.lineTo(
                        p.col * CELL_SIZE + CELL_SIZE / 2,
                        p.row * CELL_SIZE + CELL_SIZE / 2
                    )
                }
            }
            ctx.stroke()
            ctx.restore()

            // 3. Draw dots
            // Target circle (always fixed)
            const tx = arrow.targetCol * CELL_SIZE + CELL_SIZE / 2
            const ty = arrow.targetRow * CELL_SIZE + CELL_SIZE / 2
            ctx.fillStyle = arrow.color
            ctx.beginPath()
            ctx.arc(tx, ty, CELL_SIZE * 0.35, 0, Math.PI * 2)
            ctx.fill()
            
            // Draw 'P' (Parking) Icon using Lucide design language
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
            ctx.lineWidth = 2.5 // Correct Lucide-style thickness
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            const iconScale = (CELL_SIZE * 0.45) / 24
            ctx.save()
            // Center the 24x24 path at (tx, ty)
            ctx.translate(tx - 12 * iconScale, ty - 12 * iconScale)
            ctx.scale(iconScale, iconScale)
            const lucideP = new Path2D('M9 17V7h4a3 3 0 0 1 0 6H9')
            ctx.stroke(lucideP)
            ctx.restore()

            // Source square (at current animated position)
            let squareScale = 1
            if (isMarching || isWon) {
                const arrowMaxIdx = arrow.path.length - 1
                const extra = cellsCovered - arrowMaxIdx
                if (extra > 0) {
                    squareScale = Math.max(0, 1 - extra * 5) // Shrink to 0 over 0.2 cells worth of progress
                }
            }

            const s = CELL_SIZE * 0.3 * squareScale
            const r = s * 0.25 // corner radius
            ctx.fillStyle = arrow.color
            ctx.beginPath()
            ctx.roundRect(squareX - s, squareY - s, s * 2, s * 2, r)
            ctx.fill()
        })

        ctx.restore()
    }, [overlays, rows, cols, zoom, pan, activeArrowId, currentPath, isMarching, isWon, marchProgress, maxLength])

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
