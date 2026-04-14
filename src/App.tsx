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

import { ParkingCircle } from 'lucide-react'

function App() {
  const [currentLevelIndex, setCurrentLevelIndex] = useState(0)
  const { gridSize, setGridSize, backgroundColor, filenamePrefix } = useSettings()
  const { zoom, setZoom, pan, setPan, isZoomInitialized, setIsZoomInitialized } = useGridStore()
  const { resetGrid: resetGridHistory } = useGridHistoryStore()
  const { arrows, setArrows, setOverlays, setNextItemId } = useOverlaysStore()
  const { addNotification } = useNotification()
  const [isWon, setIsWon] = useState(false)
  const [isMarching, setIsMarching] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [marchProgress, setMarchProgress] = useState(0)
  const marchStartRef = useRef(0)
  const marchDurationRef = useRef(0)
  const rafRef = useRef(0)

  // Check tutorial status
  useEffect(() => {
    setShowTutorial(true)
  }, [])

  const completeTutorial = () => {
    setShowTutorial(false)
  }

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
    // Number of segments to cover for the longest path
    const maxSegments = Math.max(...currentArrows.map(a => (a.path?.length ?? 1) - 1), 1)
    const animationDistance = maxSegments + 0.5 // Add 0.5 for scaling down at the end
    const MS_PER_CELL = 120
    const duration = animationDistance * MS_PER_CELL
    
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
        // March complete — wait a tiny bit before showing win for better impact
        setTimeout(() => {
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
        }, 400) // 400ms pause to admire the completed board
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
        <div className="absolute top-0 left-0 right-0 h-24 flex items-center justify-between z-10 bg-gradient-to-b from-gray-900/90 to-transparent backdrop-blur-md px-6 border-b border-white/5">
          {/* Left Slot: Reset Button */}
          <div className="w-12 flex-shrink-0">
            <button 
              onClick={handleReset}
              className="w-10 h-10 bg-gray-800/50 hover:bg-gray-700/80 backdrop-blur-xl border border-white/5 rounded-md text-[10px] font-bold text-gray-300 uppercase tracking-widest transition-all active:scale-95 flex items-center justify-center shadow-lg"
            >
              Reset
            </button>
          </div>

          {/* Center Slot: Level Info */}
          <div className="flex flex-col items-center justify-center flex-1">
            <h1 className="text-2xl font-black text-white tracking-tight leading-none">
              {filenamePrefix || 'Level'} {currentLevelIndex + 1}
            </h1>
            <div className="w-12 h-1 bg-purple-500/30 rounded-full mt-2" />
          </div>

          {/* Right Slot: Spacer for symmetrical centering */}
          <div className="w-12 flex-shrink-0" />
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
            isWon={isWon}
            marchProgress={marchProgress}
            maxLength={Math.max(...arrows.map(a => a.path?.length ?? 0), 1)}
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

          {/* Tutorial Overlay */}
          <AnimatePresence>
            {showTutorial && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[60] flex items-center justify-center bg-gray-950/95 backdrop-blur-3xl p-8"
              >
                <div className="text-center max-w-sm w-full">
                  <div className="relative w-48 h-48 mx-auto mb-10 bg-gray-900 rounded-3xl border border-white/5 flex items-center justify-center overflow-hidden shadow-2xl">
                    <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/10 to-blue-500/10" />
                    
                    {/* Visual tutorial animation */}
                    <div className="relative w-32 h-32 flex flex-col justify-between">
                      <div className="flex justify-between items-center h-full relative">
                        {/* Square - Static and Flat */}
                        <div className="w-10 h-10 bg-purple-500 rounded-lg relative z-10" />
                        
                        {/* Connecting Line Animation - Flat */}
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: [0, 80, 0] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                          className="absolute left-5 top-1/2 -translate-y-1/2 h-4 bg-purple-500/40 rounded-full origin-left"
                        />

                        {/* Circle - Exact Gameplay Match (Filled circle + P Path) */}
                        <div className="w-12 h-12 bg-purple-500 rounded-full relative flex items-center justify-center z-10 shadow-lg">
                           <svg className="w-6 h-6 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
                           </svg>
                        </div>

                         {/* Upward Cursor Arrow Animation */}
                         <motion.div
                          animate={{ x: [0, 80, 0], scale: [1, 1.1, 1] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                          className="absolute -bottom-2 left-4 z-20 pointer-events-none text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]"
                        >
                          <svg className="w-10 h-10 -rotate-[15deg]" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                          </svg>
                        </motion.div>
                      </div>
                    </div>
                  </div>

                  <h2 className="text-3xl font-black text-white mb-4 tracking-tight">Flow Mission</h2>
                  <p className="text-gray-400 leading-relaxed mb-10 text-sm px-4">
                    Drag from <span className="text-white font-bold italic">Squares</span> to <span className="text-white font-bold italic">Circles</span> of the same color. 
                    <br/><br/>
                    <span className="text-blue-400 font-bold">Connect all pairs</span> and fill every cell to clear the level!
                  </p>
                  
                  <button 
                    onClick={completeTutorial}
                    className="w-full py-4 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-black uppercase tracking-widest rounded-2xl hover:brightness-110 transition-all shadow-xl active:scale-95 border border-white/20"
                  >
                    Start Playing
                  </button>
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
