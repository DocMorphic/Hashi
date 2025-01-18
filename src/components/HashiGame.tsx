'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { highScores as highScoresApi, type HighScore } from '@/utils/supabase';
/** --------------------------
 * 1) TYPE DEFINITIONS
 * --------------------------*/

/** Single island (node) in Hashi. */
export type Point = {
  value: number;      // final required connections
  x: number;          // grid x
  y: number;          // grid y
  bridges: {
    horizontal: number;
    vertical: number;
  };
  remainingConnections: number; // how many connections are left to place
};

/** A connection between two Points (start & end). */
export type Bridge = {
  id: string;         // unique ID for partial removal
  start: Point;       // island A
  end: Point;         // island B
  count: number;      // 1 or 2 lines
  isVertical: boolean;
};

/** The puzzle's board is just an array of Points. */
export type GameBoard = Point[];

/** Difficulty modes. */
type Mode = 'easy' | 'normal' | 'insane';

/** Configuration for each mode. */
const MODES_CONFIG = {
  easy:   { gridSize: 5, minIslands: 5,  maxIslands: 8  },
  normal: { gridSize: 7, minIslands: 8,  maxIslands: 14 },
  insane: { gridSize: 9, minIslands: 12, maxIslands: 20 },
};

/** Fun, minimalistic color gradients for bridges */
const BRIDGE_COLORS = [
  { bg: 'bg-rose-500/70', hover: 'hover:bg-rose-400/90' },
  { bg: 'bg-orange-500/70', hover: 'hover:bg-orange-400/90' },
  { bg: 'bg-lime-500/70', hover: 'hover:bg-lime-400/90' },
  { bg: 'bg-cyan-500/70', hover: 'hover:bg-cyan-400/90' },
  { bg: 'bg-indigo-500/70', hover: 'hover:bg-indigo-400/90' },
  { bg: 'bg-fuchsia-500/70', hover: 'hover:bg-fuchsia-400/90' },
  { bg: 'bg-violet-500/70', hover: 'hover:bg-violet-400/90' },
  { bg: 'bg-yellow-500/70', hover: 'hover:bg-yellow-400/90' },
  { bg: 'bg-emerald-500/70', hover: 'hover:bg-emerald-400/90' },
  { bg: 'bg-sky-500/70', hover: 'hover:bg-sky-400/90' },
];

/** Get a color for a bridge based on points */
const getBridgeColor = (start: Point, end: Point) => {
  const colorIndex = (start.x * 3 + end.y * 2) % BRIDGE_COLORS.length;
  return BRIDGE_COLORS[colorIndex];
};

/** We'll keep a scale so bigger grids still fit 500×500. */
const RENDER_SCALES: Record<Mode, number> = {
  easy: 4,
  normal: 7,
  insane: 9,
};

/** Score multipliers for each mode */
const SCORE_MULTIPLIERS: Record<Mode, number> = {
  easy: 1,
  normal: 2,
  insane: 4,
};

/** --------------------------
 * 2) PUZZLE GENERATION
 * --------------------------*/

/**
 * Shuffle an array in-place (Fisher-Yates).
 */
function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Create a unique string id for each new bridge. */
function createUniqueId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `bridge-${Date.now()}-${Math.random()}`;
}

/**
 * Return true if there's an island strictly between (start, end) in row or column.
 */
function hasIslandInBetween(start: Point, end: Point, all: Point[]): boolean {
  if (start.x !== end.x && start.y !== end.y) return true; // not same row/col => can't connect
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return all.some((p) => {
    if (p === start || p === end) return false;
    // vertical
    if (start.x === end.x) {
      return p.x === start.x && p.y > minY && p.y < maxY;
    }
    // horizontal
    return p.y === start.y && p.x > minX && p.x < maxX;
  });
}

/**
 * A minimal union-find for MST creation (ensuring single connected component).
 */
function unionFindInit(points: Point[]) {
  const parent = new Map<Point, Point>();
  points.forEach((p) => parent.set(p, p));
  function find(a: Point): Point {
    if (parent.get(a) !== a) {
      parent.set(a, find(parent.get(a)!));
    }
    return parent.get(a)!;
  }
  function union(a: Point, b: Point) {
    parent.set(find(b), find(a));
  }
  function sameSet(a: Point, b: Point) {
    return find(a) === find(b);
  }
  return { find, union, sameSet };
}

/**
 * Generate a puzzle by:
 * 1. Placing random islands in the grid
 * 2. Building a minimal spanning tree (MST) of single edges
 * 3. Possibly add/upgrade a few edges (some can become double)
 * 4. Reject if any island has value=0
 */
function generateValidPuzzle(mode: Mode): GameBoard {
  const { gridSize, minIslands, maxIslands } = MODES_CONFIG[mode];

  for (let attempt = 0; attempt < 100; attempt++) {
    // 1) Randomly pick how many islands
    const islandCount = Math.floor(Math.random() * (maxIslands - minIslands + 1)) + minIslands;

    // choose unique positions
    const positions: { x: number; y: number }[] = [];
    while (positions.length < islandCount) {
      const x = Math.floor(Math.random() * gridSize);
      const y = Math.floor(Math.random() * gridSize);
      if (!positions.some((p) => p.x === x && p.y === y)) {
        positions.push({ x, y });
      }
    }

    // Create the points
    let islands: GameBoard = positions.map((pos) => ({
      x: pos.x,
      y: pos.y,
      value: 0,
      bridges: { horizontal: 0, vertical: 0 },
      remainingConnections: 0,
    }));

    // 2) Build list of potential edges (same row/col, no island in between)
    const potential: Array<{ start: Point; end: Point }> = [];
    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const A = islands[i];
        const B = islands[j];
        if (A.x === B.x || A.y === B.y) {
          if (!hasIslandInBetween(A, B, islands)) {
            potential.push({ start: A, end: B });
          }
        }
      }
    }
    shuffleArray(potential);

    // We'll store chosen edges in an internal array
    const usedEdges: Array<{
      start: Point;
      end: Point;
      count: number; // 1 or 2
    }> = [];

    // 3) Create MST via union-find, single edges only
    const { sameSet, union } = unionFindInit(islands);
    for (const e of potential) {
      if (!sameSet(e.start, e.end)) {
        usedEdges.push({ start: e.start, end: e.end, count: 1 });
        union(e.start, e.end);
      }
    }

    // 4) Possibly add/upgrade edges for variety
    let extrasToAdd = Math.floor(islands.length / 2);
    shuffleArray(potential);
    for (const e of potential) {
      if (extrasToAdd <= 0) break;
      // see if we have an existing edge
      const existing = usedEdges.find(
        (ue) =>
          (ue.start === e.start && ue.end === e.end) ||
          (ue.start === e.end && ue.end === e.start)
      );
      if (existing) {
        // upgrade 1->2 if not done
        if (existing.count < 2) {
          existing.count = 2;
          extrasToAdd--;
        }
      } else {
        // add new single
        usedEdges.push({ start: e.start, end: e.end, count: 1 });
        extrasToAdd--;
      }
    }

    // 5) Summation: each island gets +count from edges connecting it
    usedEdges.forEach((ed) => {
      ed.start.value += ed.count;
      ed.end.value += ed.count;
    });

    // If any island is zero => discard puzzle
    if (islands.some((i) => i.value === 0)) {
      continue; // try again
    }

    // 6) Convert final to puzzle form
    islands = islands.map((p) => ({
      ...p,
      remainingConnections: p.value,
    }));
    return islands; // success
  }

  // fallback if no valid puzzle found
  return [
    {
      x: 0,
      y: 0,
      value: 2,
      remainingConnections: 2,
      bridges: { horizontal: 0, vertical: 0 },
    },
    {
      x: 1,
      y: 0,
      value: 2,
      remainingConnections: 2,
      bridges: { horizontal: 0, vertical: 0 },
    },
  ];
}

/** --------------------------
 * 3) REACT COMPONENT
 * --------------------------*/

/** Score entry type */
type ScoreEntry = HighScore;

/** Initial high scores - these will be used as default/static high scores */
const INITIAL_HIGH_SCORES: ScoreEntry[] = [
  { username: 'mystic_mewtwo', score: 25, timestamp: 1709251200000 }
];

export default function HashiGame() {
  // State
  const [mode, setMode] = useState<Mode>('easy');
  const [board, setBoard] = useState<GameBoard>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragLine, setDragLine] = useState<{ x: number; y: number } | null>(null);
  const [isGameWon, setIsGameWon] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingScore, setIsUpdatingScore] = useState(false);

  // New state for scoring
  const [username, setUsername] = useState<string>('');
  const [currentScore, setCurrentScore] = useState<number>(0);
  const [highScores, setHighScores] = useState<ScoreEntry[]>([]);
  const [showUsernameModal, setShowUsernameModal] = useState(true);

  // Load high scores and current user's score on mount
  useEffect(() => {
    const loadHighScores = async () => {
      try {
        const scores = await highScoresApi.getAll();
        if (scores.length > 0) {
          setHighScores(scores);
          // If we have a username, set their current score
          if (username) {
            const userScore = scores.find(score => score.username === username);
            if (userScore) {
              setCurrentScore(userScore.score);
            }
          }
        } else {
          setHighScores(INITIAL_HIGH_SCORES);
        }
      } catch (error) {
        console.error('Error loading high scores:', error);
        setHighScores(INITIAL_HIGH_SCORES);
      }
    };

    loadHighScores();
  }, [username]);

  // Handle username submission
  const handleUsernameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setShowUsernameModal(false);
      // Reset score when new username is set
      setCurrentScore(0);
    }
  };

  // Generate random cool username
  const generateRandomUsername = () => {
    const adjectives = [
      'shiny', 'mystic', 'swift', 'fierce', 'shadow', 'cosmic', 
      'thunder', 'crystal', 'ancient', 'mighty', 'lunar', 'royal',
      'golden', 'silver', 'blazing', 'frozen', 'psychic', 'stellar'
    ];
    const pokemon = [
      'pikachu', 'charizard', 'mewtwo', 'snorlax', 'gengar', 
      'dragonite', 'gyarados', 'eevee', 'lucario', 'gardevoir',
      'rayquaza', 'umbreon', 'sylveon', 'mew', 'lugia', 'arceus',
      'greninja', 'mimikyu', 'bulbasaur', 'squirtle'
    ];
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const poke = pokemon[Math.floor(Math.random() * pokemon.length)];
    setUsername(`${adj}_${poke}`);
  };

  /** 
   * Reload puzzle 
   */
  const loadRandomPuzzle = useCallback(() => {
    if (isLoading) return; // Prevent multiple loads
    setIsLoading(true);
    setTimeout(() => {
      const puzzle = generateValidPuzzle(mode);
      setBoard(puzzle);
      setBridges([]);
      setSelectedPoint(null);
      setDragLine(null);
      setIsDragging(false);
      setIsGameWon(false);
      setIsLoading(false);
      setIsUpdatingScore(false); // Reset the score update flag
    }, 300);
  }, [mode, isLoading]);

  // Auto-load next puzzle on win with better score handling
  useEffect(() => {
    if (isGameWon && username && !isUpdatingScore) {
      setIsUpdatingScore(true); // Set flag to prevent multiple updates
      const scoreMultiplier = SCORE_MULTIPLIERS[mode];
      const newScore = currentScore + scoreMultiplier;
      
      const updateScore = async () => {
        try {
          const result = await highScoresApi.upsert({
            username,
            score: newScore,
            timestamp: Date.now()
          });

          if (result) {
            setCurrentScore(newScore);
            // Refresh high scores
            const scores = await highScoresApi.getAll();
            setHighScores(scores);
          }
        } catch (error) {
          console.error('Error updating score:', error);
        }

        // Use RAF to ensure we're not blocking the UI
        requestAnimationFrame(() => {
          setTimeout(() => {
            loadRandomPuzzle();
          }, 1500);
        });
      };

      updateScore();
    }
  }, [isGameWon, mode, currentScore, username, loadRandomPuzzle, isUpdatingScore]);

  // Generate puzzle on mount / mode change
  useEffect(() => {
    if (!isUpdatingScore) { // Only generate new puzzle if not updating score
      const puzzle = generateValidPuzzle(mode);
      setBoard(puzzle);
      setBridges([]);
      setIsGameWon(false);
      setSelectedPoint(null);
      setDragLine(null);
      setIsDragging(false);
    }
  }, [mode, isUpdatingScore]);

  /**
   * Check if we can connect these two points (same row/col, each > 0, no in-between).
   */
  const isValidConnection = (start: Point, end: Point): boolean => {
    if (start.x !== end.x && start.y !== end.y) return false;
    if (start.remainingConnections <= 0 || end.remainingConnections <= 0) return false;
    // check in-between
    const blocked = board.some((p) => {
      if (p === start || p === end) return false;
      if (start.x === end.x) {
        // vertical
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        return p.x === start.x && p.y > minY && p.y < maxY;
      } else {
        // horizontal
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        return p.y === start.y && p.x > minX && p.x < maxX;
      }
    });
    return !blocked;
  };

  /**
   * 0->1->2->remove bridging
   */
  const addOrUpdateBridge = (start: Point, end: Point) => {
    const isVertical = start.x === end.x;
    // find existing
    const idx = bridges.findIndex(
      (b) =>
        (b.start === start && b.end === end) ||
        (b.start === end && b.end === start)
    );
    if (idx >= 0) {
      const existing = bridges[idx];
      if (existing.count >= 2) {
        // remove => 0
        setBridges((prev) => prev.filter((_, i) => i !== idx));
        // restore 2
        updatePointConnections(start, end, -2);
      } else {
        // 1->2
        const updated = [...bridges];
        updated[idx] = { ...existing, count: 2 };
        setBridges(updated);
        updatePointConnections(start, end, 1);
      }
    } else {
      // none => new single
      const newBridge: Bridge = {
        id: createUniqueId(),
        start,
        end,
        count: 1,
        isVertical,
      };
      setBridges((prev) => [...prev, newBridge]);
      updatePointConnections(start, end, 1);
    }
  };

  /**
   * increment/decrement the two islands' remainingConnections by '(-)change'
   * 'change' is how many lines we add or remove
   */
  const updatePointConnections = (start: Point, end: Point, change: number) => {
    setBoard((old) =>
      old.map((p) => {
        // coordinate-based match
        if (
          (p.x === start.x && p.y === start.y) ||
          (p.x === end.x && p.y === end.y)
        ) {
          return {
            ...p,
            remainingConnections: p.remainingConnections - change,
          };
        }
        return p;
      })
    );
  };

  /**
   * Clicking an island
   */
  const handlePointClick = (pt: Point) => {
    if (!selectedPoint) {
      setSelectedPoint(pt);
      setIsDragging(true);
      return;
    }
    if (pt === selectedPoint) {
      setSelectedPoint(null);
      setIsDragging(false);
      return;
    }
    // attempt bridging
    if (isValidConnection(selectedPoint, pt)) {
      addOrUpdateBridge(selectedPoint, pt);
    }
    setSelectedPoint(null);
    setIsDragging(false);
  };

  /**
   * Clicking an existing bridge => partial removal:
   * (2->1 or 1->0)
   */
  const handleBridgeClick = (bridge: Bridge) => {
    if (bridge.count > 1) {
      // 2->1
      setBridges((prev) =>
        prev.map((b) => {
          if (b.id === bridge.id) {
            return { ...b, count: 1 };
          }
          return b;
        })
      );
      // restore 1 to each island
      setBoard((old) =>
        old.map((p) => {
          if (
            (p.x === bridge.start.x && p.y === bridge.start.y) ||
            (p.x === bridge.end.x && p.y === bridge.end.y)
          ) {
            return { ...p, remainingConnections: p.remainingConnections + 1 };
          }
          return p;
        })
      );
    } else {
      // 1->0 remove
      setBridges((prev) => prev.filter((b) => b.id !== bridge.id));
      // restore 1
      setBoard((old) =>
        old.map((p) => {
          if (
            (p.x === bridge.start.x && p.y === bridge.start.y) ||
            (p.x === bridge.end.x && p.y === bridge.end.y)
          ) {
            return { ...p, remainingConnections: p.remainingConnections + 1 };
          }
          return p;
        })
      );
    }
  };

  /**
   * Mouse Move => drag preview or auto-connect
   */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedPoint) return;
    const scale = RENDER_SCALES[mode];
    
    // Get the game board element
    const gameBoard = e.currentTarget.querySelector('.game-board') as HTMLElement;
    if (!gameBoard) return;
    
    const rect = gameBoard.getBoundingClientRect();
    
    // Calculate position relative to the game board
    const x = ((e.clientX - rect.left) / rect.width) * scale;
    const y = ((e.clientY - rect.top) / rect.height) * scale;

    setDragLine({ x, y });

    // check if near another island
    const near = board.find((pp) => {
      const dx = Math.abs(pp.x - x);
      const dy = Math.abs(pp.y - y);
      return dx < 0.5 && dy < 0.5 && pp !== selectedPoint;
    });
    if (near && isValidConnection(selectedPoint, near)) {
      addOrUpdateBridge(selectedPoint, near);
      setSelectedPoint(null);
      setIsDragging(false);
      setDragLine(null);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setSelectedPoint(null);
    setDragLine(null);
  };

  /**
   * Preview line style
   */
  const getDragLineStyles = () => {
    if (!selectedPoint || !dragLine) return {};
    const scale = RENDER_SCALES[mode];
    const dx = dragLine.x - selectedPoint.x;
    const dy = dragLine.y - selectedPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      left: `${(selectedPoint.x / scale) * 100}%`,
      top: `${(selectedPoint.y / scale) * 100}%`,
      width: '4px',
      height: `${(length / scale) * 100}%`,
      transform: `translateX(-2px) rotate(${
        (Math.atan2(dy, dx) * 180) / Math.PI - 90
      }deg)`,
      transformOrigin: 'top',
    };
  };

  /**
   * Check for win => all islands 0
   */
  useEffect(() => {
    if (board.length > 0) {
      const done = board.every((p) => p.remainingConnections === 0);
      setIsGameWon(done);
    }
  }, [board]);

  // scale for rendering
  const scaleVal = RENDER_SCALES[mode];

  return (
    <div className="flex min-h-screen bg-black text-white">
      {/* Left Sidebar */}
      <div className="w-64 p-4 border-r border-white/10 flex flex-col gap-4 overflow-y-auto">
        {/* Mode Select */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setMode('easy')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === 'easy' 
                ? 'bg-white text-black shadow-lg' 
                : 'bg-zinc-800 text-white hover:bg-zinc-700'
            }`}
          >
            Easy (1x Multiplier)
          </button>
          <button
            onClick={() => setMode('normal')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === 'normal' 
                ? 'bg-white text-black shadow-lg' 
                : 'bg-zinc-800 text-white hover:bg-zinc-700'
            }`}
          >
            Normal (2x)
          </button>
          <button
            onClick={() => setMode('insane')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              mode === 'insane' 
                ? 'bg-white text-black shadow-lg' 
                : 'bg-zinc-800 text-white hover:bg-zinc-700'
            }`}
          >
            I&apos;m Bored (4x)
          </button>
        </div>

        <button
          onClick={loadRandomPuzzle}
          disabled={isLoading}
          className="px-4 py-1.5 bg-white text-black text-sm rounded-full font-medium shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg"
        >
          {isLoading ? 'Loading...' : 'New Puzzle'}
        </button>

        {/* Game Rules */}
        <div className="mt-2">
          <h3 className="text-sm font-bold mb-2 text-white/80">How to Play</h3>
          <div className="space-y-2 text-xs text-white/60">
            <p>🎯 Goal: Connect all islands with bridges until each island has its required number of connections.</p>
            <p>🌉 Rules:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Numbers show how many bridges each island needs</li>
              <li>Bridges can be single or double</li>
              <li>Bridges can only go horizontally or vertically</li>
              <li>Bridges can cross each other</li>
              <li>All islands must be connected</li>
            </ul>
            <p>🎮 Controls:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Click and drag between islands to connect</li>
              <li>Click on a bridge to remove it</li>
              <li>Complete the puzzle to score points</li>
            </ul>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="mt-2">
          <h3 className="text-sm font-bold mb-2 text-white/80">Top Players</h3>
          <div className="space-y-2">
            {highScores.map((entry) => (
              <div 
                key={`${entry.username}-${entry.timestamp}`}
                className={`text-xs flex justify-between items-center ${
                  entry.username === username ? 'text-purple-400 font-medium' : 'text-white/60'
                }`}
              >
                <span>{entry.username}</span>
                <span className="font-mono">{entry.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Game Area */}
      <div 
        className="flex-1 flex items-center justify-center relative"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Username Modal */}
        {showUsernameModal && (
          <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
            <div className="bg-zinc-900 p-8 rounded-2xl shadow-2xl border border-zinc-700">
              <div className="flex items-center gap-4 mb-4">
                <h2 className="text-2xl font-bold text-white">Enter Your Username</h2>
              </div>
              <form onSubmit={handleUsernameSubmit} className="space-y-4">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 bg-black border border-zinc-700 rounded-lg text-white"
                  placeholder="Your username"
                />
                <button
                  type="button"
                  onClick={generateRandomUsername}
                  className="w-full px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                >
                  Generate Random Username
                </button>
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-white text-black rounded-lg font-medium"
                >
                  Start Playing
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Game Board */}
        {board.length > 0 && (
          <div
            className="relative w-[500px] h-[500px] game-board"
          >
            {/* Bridges */}
            {bridges.map((bridge) => {
              const { id, start, end, count, isVertical } = bridge;
              const dist = isVertical
                ? Math.abs(end.y - start.y)
                : Math.abs(end.x - start.x);

              const leftPct = isVertical
                ? (start.x / scaleVal) * 100
                : (Math.min(start.x, end.x) / scaleVal) * 100;
              const topPct = isVertical
                ? (Math.min(start.y, end.y) / scaleVal) * 100
                : (start.y / scaleVal) * 100;

              const { bg, hover } = getBridgeColor(start, end);

              return [...Array(count)].map((_, lineIdx) => {
                const spacing = 6;
                const total = (count - 1) * spacing;
                const offset = lineIdx * spacing - total / 2;

                return (
                  <div
                    key={`${id}-${lineIdx}`}
                    className={`absolute transform cursor-pointer transition-colors ${bg} ${hover}`}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: isVertical ? '3px' : `${(dist / scaleVal) * 100}%`,
                      height: isVertical ? `${(dist / scaleVal) * 100}%` : '3px',
                      transform: isVertical
                        ? `translateX(${offset}px)`
                        : `translateY(${offset}px)`,
                    }}
                    onClick={() => handleBridgeClick(bridge)}
                  />
                );
              });
            }).flat()}

            {/* Preview line while dragging */}
            {isDragging && selectedPoint && dragLine && (
              <div
                className="absolute bg-white/30 pointer-events-none"
                style={getDragLineStyles()}
              />
            )}

            {/* Islands */}
            {board.map((point) => {
              const left = (point.x / scaleVal) * 100;
              const top = (point.y / scaleVal) * 100;
              const isLarge = scaleVal > 5;
              const size = isLarge ? 'w-8 h-8 text-base' : 'w-10 h-10 text-lg';

              let bgColor = 'bg-black';
              let borderColor = 'border-2 border-white/20';
              
              if (selectedPoint === point) {
                bgColor = 'bg-black';
                borderColor = 'border-2 border-white';
              } else if (point.remainingConnections === 0) {
                bgColor = 'bg-black';
                borderColor = 'border-2 border-emerald-500';
              }

              return (
                <div
                  key={`${point.x}-${point.y}`}
                  className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${size}
                    ${bgColor} ${borderColor} rounded-full shadow-lg
                    flex items-center justify-center cursor-pointer select-none
                    hover:shadow-xl transition-colors`}
                  style={{ left: `${left}%`, top: `${top}%` }}
                  onMouseDown={() => handlePointClick(point)}
                >
                  <span className="font-bold text-white select-none">
                    {point.remainingConnections}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Current Score with Confetti */}
        <div className="absolute top-4 right-8 text-right">
          <div className="text-sm text-white/60">Playing as</div>
          <div className="font-medium text-white mb-2">{username}</div>
          <div className="text-sm text-white/60">Score</div>
          <div className="flex items-center justify-end gap-2">
            <div className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent animate-pulse">
              {currentScore}
            </div>
            {isGameWon && (
              <div className="animate-bounce text-2xl" key={currentScore}>
                🎊
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
