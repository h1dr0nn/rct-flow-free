import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GridCanvas } from './components/GridCanvas'
import { audio } from './utils/audio'
import { 
  useSettings, 
  useGridStore, 
  useGridHistoryStore, 
  useOverlaysStore, 
  useNotification,
  type Arrow
} from './stores'

function App() {
  const [currentLevelIndex, setCurrentLevelIndex] = useState(0)
  const { gridSize, setGridSize, backgroundColor, filenamePrefix } = useSettings()
  const { zoom, setZoom, pan, setPan, isZoomInitialized, setIsZoomInitialized } = useGridStore()
  const { resetGrid: resetGridHistory } = useGridHistoryStore()
  const { arrows, setArrows, setOverlays, setNextItemId } = useOverlaysStore()
  const { addNotification } = useNotification()
  const [isWon, setIsWon] = useState(false)
  const [isMarching, setIsMarching] = useState(false)
  const [marchProgress, setMarchProgress] = useState(0)
  const marchStartRef = useRef(0)
  const marchDurationRef = useRef(0)
  const rafRef = useRef(0)

  const loadLevel = async () => {
    try {
      // Load color palette and level data in parallel
      const [colorsRes, levelRes] = await Promise.all([
        fetch('/colors.json'),
        fetch(`/levels/level${currentLevelIndex + 1}.json`)
      ])
      const colors: { id: number; name: string; hex: string }[] = await colorsRes.json()
      const data = await levelRes.json()

      const colorMap = new Map(colors.map(c => [c.id, c.hex]))

      setGridSize({ width: data.width, height: data.height })
      
      // Initialize arrows from dot pairs, resolving colorId → hex
      const arrows = data.dots.map((dot: any, index: number) => ({
        id: index + 1,
        row: dot.a.r,
        col: dot.a.c,
        targetRow: dot.b.r,
        targetCol: dot.b.c,
        direction: 'right',
        color: colorMap.get(dot.colorId) ?? '#ffffff',
        path: [
          { row: dot.a.r, col: dot.a.c }
        ],
        isCompleted: false
      }))

      setOverlays({ arrows, obstacles: [] })
      setNextItemId(arrows.length + 1)
      
      // Clear grid data
      const emptyGrid = Array(data.height).fill(null).map(() => Array(data.width).fill(false))
      resetGridHistory(emptyGrid)
      
      setIsZoomInitialized(false)
    } catch (error) {
      console.error('Failed to load level:', error)
      addNotification('error', 'Failed to load level')
    }
  }

  const startMarch = useCallback((currentArrows: Arrow[]) => {
    // Compute duration from longest path — all squares arrive at the same time
    const longestPath = Math.max(...currentArrows.map(a => a.path?.length ?? 0))
    const duration = Math.min(Math.max(longestPath * 100, 800), 3000) // 800ms..3s
    marchDurationRef.current = duration
    marchStartRef.current = performance.now()
    setIsMarching(true)
    setMarchProgress(0)

    const animate = (now: number) => {
      const elapsed = now - marchStartRef.current
      const t = Math.min(elapsed / marchDurationRef.current, 1)
      setMarchProgress(t)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        // March complete — show win
        setIsMarching(false)
        setIsWon(true)
        audio.playWin()
        addNotification('success', 'Level Complete!')
        setTimeout(() => {
          setCurrentLevelIndex(prev => {
            const next = prev + 1
            return next < 10 ? next : 0
          })
        }, 2000)
      }
    }
    rafRef.current = requestAnimationFrame(animate)
  }, [addNotification])

  const handleReset = () => {
    cancelAnimationFrame(rafRef.current)
    setIsMarching(false)
    setMarchProgress(0)
    setIsWon(false)
    loadLevel()
  }

  const checkWinCondition = (currentArrows: Arrow[]) => {
    if (currentArrows.length === 0) return false
    
    // 1. All paths must be completed
    const allCompleted = currentArrows.every(a => a.isCompleted)
    if (!allCompleted) return false

    // 2. All cells must be occupied
    const gridCells = gridSize.width * gridSize.height
    const occupiedCells = new Set()
    currentArrows.forEach(a => {
      a.path?.forEach(p => occupiedCells.add(`${p.row},${p.col}`))
      // Also add target dot as it's part of the flow but path[0] to path[last] only covers segment points
      // Actually my GridCanvas path includes all points including start and end dots
    })

    if (occupiedCells.size < gridCells) return false

    return true
  }

  const handleArrowsUpdate = (newArrows: Arrow[]) => {
    setArrows(newArrows)
    if (!isMarching && checkWinCondition(newArrows)) {
      startMarch(newArrows)
    }
  }

  // Reload when level index changes
  useEffect(() => {
    handleReset()
  }, [currentLevelIndex])

  // Initial load
  useEffect(() => {
    loadLevel()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])


  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[#0a0a0f] p-4 sm:p-8"
      style={{
        backgroundImage: `radial-gradient(circle at center, ${backgroundColor}33 0%, #0a0a0f 100%)`
      }}
    >
      {/* 9:16 portrait container */}
      <div
        className="relative overflow-hidden bg-[#0f111a] shadow-[0_0_50px_rgba(0,0,0,0.5)] border border-gray-800/50 rounded-[2rem]"
        style={{
          aspectRatio: '9 / 16',
          height: 'min(90vh, 100svh)',
          maxHeight: 'min(1200px, 100svh)',
          maxWidth: 'calc(min(90vh, 100svh) * 9 / 16)',
          width: '100%',
        }}
      >
        {/* Mobile Header */}
        <div className="absolute top-0 left-0 right-0 h-24 flex flex-col items-center justify-center z-10 bg-gradient-to-b from-gray-900/90 to-transparent backdrop-blur-md px-6 pt-4 border-b border-white/5">
          {/* Top Left Reset Button */}
          <button 
            onClick={handleReset}
            className="absolute top-6 left-6 w-10 h-10 bg-gray-800/50 hover:bg-gray-700/80 backdrop-blur-xl border border-white/5 rounded-md text-[10px] font-bold text-gray-300 uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center shadow-lg"
          >
            Reset
          </button>

          <h1 className="text-2xl font-black text-white tracking-tight">
            {filenamePrefix || 'Level'} {currentLevelIndex + 1}
          </h1>
          <div className="w-12 h-1 bg-purple-500/30 rounded-full mt-2" />
        </div>

        {/* Content Area */}
        <div className="flex flex-col h-full pt-20">
          <GridCanvas
            rows={gridSize.height}
            cols={gridSize.width}
            overlays={{ arrows, obstacles: [] }}
            onArrowsUpdate={handleArrowsUpdate}
            zoom={zoom}
            setZoom={setZoom}
            pan={pan}
            setPan={setPan}
            isZoomInitialized={isZoomInitialized}
            setIsZoomInitialized={setIsZoomInitialized}
            isMarching={isMarching}
            marchProgress={marchProgress}
          />

          {/* Win Overlay */}
          <AnimatePresence>
            {isWon && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none"
              >
                <div className="text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    className="w-24 h-24 border-4 border-t-purple-500 border-r-transparent border-b-blue-500 border-l-transparent rounded-full mx-auto mb-6"
                  />
                  <h2 className="text-4xl font-black text-white italic tracking-tighter mb-2">PERFECT!</h2>
                  <p className="text-purple-400 font-bold uppercase tracking-widest text-xs">Level {currentLevelIndex + 1} Cleared</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Subtle Footer Decor */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center opacity-20 pointer-events-none">
          <div className="text-[8px] text-gray-400 tracking-widest uppercase font-medium">
            Advanced Game Agent Engine
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
