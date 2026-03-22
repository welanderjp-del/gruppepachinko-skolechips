/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { 
  Users, 
  Play, 
  RotateCcw, 
  Shuffle, 
  Copy, 
  Check, 
  Settings2,
  ChevronRight,
  ChevronDown,
  Search,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

interface Student {
  id: string;
  name: string;
  color: string;
}

interface Group {
  id: number;
  students: string[];
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  student: Student;
  settled: boolean;
  released: boolean;
  binIndex: number | null;
  stuckTimer: number;
  color: string;
}

interface Peg {
  x: number;
  y: number;
  radius: number;
}

interface Bin {
  x: number;
  width: number;
  maxCapacity: number;
  currentCount: number;
}

// --- Constants ---

const GRAVITY = 0.1; // Slightly faster to reduce slow-mo feel
const BOUNCE = 0.85;  
const WALL_BOUNCE = 0.85; 
const FRICTION = 0.992; 
const BIN_FRICTION = 0.4; // More friction to stop balls faster in bins
const PEG_RADIUS = 4;
const BALL_RADIUS = 16; 
const SNAP_THRESHOLD = 0.3; 
const STUCK_THRESHOLD = 120; // frames

const COLORS = [
  '#F87171', '#FB923C', '#FBBF24', '#34D399', 
  '#60A5FA', '#818CF8', '#A78BFA', '#F472B6'
];

// --- Utilities ---

const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

// --- Components ---

const ResultsList = memo(({ groups, copied, onCopy }: { groups: Group[], copied: boolean, onCopy: () => void }) => {
  if (groups.length === 0) return null;
  
  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
          Grupper
        </h2>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors bg-emerald-50 px-3 py-1.5 rounded-full"
        >
          <Copy size={14} />
          {copied ? 'Kopieret!' : 'Kopiér alt'}
        </button>
      </div>

      <div className="grid gap-2">
        {groups.map((group) => (
          <div 
            key={group.id} 
            className="flex items-center gap-3 bg-white/60 backdrop-blur-sm border border-white/40 rounded-xl p-2.5 shadow-sm hover:shadow-md transition-all duration-300 group"
          >
            <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold shadow-sm">
              {group.id}
            </span>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {group.students.length > 0 ? (
                group.students.map((student, idx) => (
                  <span
                    key={idx}
                    className="text-slate-700 text-sm font-semibold"
                  >
                    {student}{idx < group.students.length - 1 ? ',' : ''}
                  </span>
                ))
              ) : (
                <span className="text-slate-400 text-xs italic">Venter på elever...</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

ResultsList.displayName = 'ResultsList';

export default function App() {
  // --- State ---
  const [namesText, setNamesText] = useState(() => localStorage.getItem('pachinko_names') || '');
  const [mode, setMode] = useState<'count' | 'size'>(() => (localStorage.getItem('pachinko_mode') as any) || 'count');
  const [targetValue, setTargetValue] = useState(() => Number(localStorage.getItem('pachinko_target')) || 4);
  const [isSimulating, setIsSimulating] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isManualZoom, setIsManualZoom] = useState(false);
  const isSimulatingRef = useRef(false);
  const simulationStartTimeRef = useRef(0);
  const lastGroupUpdateRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(null);
  
  // Simulation refs (to avoid re-renders during physics)
  const ballsRef = useRef<Ball[]>([]);
  const pegsRef = useRef<Peg[]>([]);
  const binsRef = useRef<Bin[]>([]);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const isFirstFrameRef = useRef(true);

  // --- Resize Handling ---
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        setCanvasSize({ width, height });
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // --- Persistence ---
  useEffect(() => {
    localStorage.setItem('pachinko_names', namesText);
    localStorage.setItem('pachinko_mode', mode);
    localStorage.setItem('pachinko_target', targetValue.toString());
  }, [namesText, mode, targetValue]);

  // --- Logic ---

  const students = useMemo(() => {
    return namesText
      .split('\n')
      .map(n => n.trim())
      .filter(n => n !== '')
      .map((name, i) => ({
        id: `s-${i}`,
        name,
        color: COLORS[i % COLORS.length]
      }));
  }, [namesText]);

  const calculatedGroupCount = useMemo(() => {
    if (students.length === 0) return 1;
    if (mode === 'count') return Math.max(1, targetValue);
    return Math.max(1, Math.ceil(students.length / targetValue));
  }, [students, mode, targetValue]);

  const maxStudentsPerGroup = useMemo(() => {
    if (students.length === 0) return 0;
    if (mode === 'size') return targetValue;
    return Math.ceil(students.length / targetValue);
  }, [students, mode, targetValue]);

  // Setup board structure whenever configuration changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.width;
    const height = canvas.height;
    const groupCount = calculatedGroupCount;

    // Setup Bins
    const binWidth = BALL_RADIUS * 2.2; // Slightly narrower for "one ball at a time" feel
    const totalBinsWidth = groupCount * binWidth;
    const binStartX = Math.floor((width - totalBinsWidth) / 2);

    const binHeight = maxStudentsPerGroup * BALL_RADIUS * 2 + 15; // Reduced extra space
    const binTopY = height - binHeight;
    
    binsRef.current = Array.from({ length: groupCount }, (_, i) => ({
      x: binStartX + i * binWidth,
      width: binWidth,
      maxCapacity: maxStudentsPerGroup,
      currentCount: 0
    }));

    // Setup Pegs (Galton pattern matching image)
    const newPegs: Peg[] = [];
    const rows = 6;
    const startY = 120; 
    const pegZoneBottomY = binTopY - 80; // Leave a zone above bins
    const rowSpacing = (pegZoneBottomY - startY) / rows;
    const hSpacing = BALL_RADIUS * 6;
    const centerX = width / 2;
    
    for (let r = 0; r < rows; r++) {
      const y = startY + r * rowSpacing;
      const isEven = r % 2 === 0;
      
      // Calculate funnel bounds at this Y for peg placement
      const funnelBottomY = binTopY;
      const leftWallX = binStartX * (y / funnelBottomY);
      const rightWallX = width - (width - (binStartX + totalBinsWidth)) * (y / funnelBottomY);
      
      // Generate pegs symmetrically around center
      const maxPegs = 10;
      for (let p = -maxPegs; p <= maxPegs; p++) {
        let px = centerX;
        if (isEven) {
          px += p * hSpacing;
        } else {
          px += (p + 0.5) * hSpacing;
        }
        
        // Final safety check
        if (px > leftWallX + BALL_RADIUS * 3 && px < rightWallX - BALL_RADIUS * 3) {
          newPegs.push({ x: px, y, radius: PEG_RADIUS });
        }
      }
    }
    pegsRef.current = newPegs;

    // Initial Ball Placement (Max 2 rows)
    const ballsPerRow = Math.max(1, Math.ceil(students.length / 2));
    const spacing = BALL_RADIUS * 2.4;
    
    ballsRef.current = students.map((s, i) => {
      const row = Math.floor(i / ballsPerRow);
      const col = i % ballsPerRow;
      const rowCount = Math.min(ballsPerRow, students.length - row * ballsPerRow);
      const rowWidth = (rowCount - 1) * spacing;
      const rowStartX = (width - rowWidth) / 2;

      return {
        x: rowStartX + col * spacing,
        y: 20 + row * spacing,
        vx: 0,
        vy: 0,
        radius: BALL_RADIUS,
        student: s,
        settled: false,
        released: false,
        binIndex: null,
        stuckTimer: 0,
        color: s.color
      };
    });

    setGroups(Array.from({ length: groupCount }, (_, i) => ({ id: i + 1, students: [] })));
  }, [calculatedGroupCount, students, maxStudentsPerGroup, canvasSize]);

  const initSimulation = () => {
    if (students.length === 0) return;
    
    // Ensure balls are initialized if they aren't for some reason
    if (ballsRef.current.length === 0) {
      handleReset();
    }

    // Release all balls with a significant random nudge
    ballsRef.current.forEach((ball) => {
      ball.released = true;
      ball.settled = false;
      ball.vx = (Math.random() - 0.5) * 12; // Much bigger initial push
      ball.vy = 1 + Math.random() * 2;
      ball.stuckTimer = 0;
    });

    setShowSettings(false);
    isSimulatingRef.current = true;
    setIsSimulating(true);
    simulationStartTimeRef.current = Date.now();
    lastGroupUpdateRef.current = 0;
  };

  const updatePhysics = () => {
    if (!isSimulatingRef.current) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = canvas.width;
    const height = canvas.height;
    const balls = ballsRef.current;
    const pegs = pegsRef.current;
    const bins = binsRef.current;
    const binWidth = BALL_RADIUS * 2.2;
    const totalBinsWidth = bins.length * binWidth;
    const binStartX = Math.floor((width - totalBinsWidth) / 2);
    const binEndX = binStartX + totalBinsWidth;
    const binHeight = maxStudentsPerGroup * BALL_RADIUS * 2 + 15;
    const binTopY = height - binHeight;
    const funnelBottomY = binTopY;
    const floorY = height - 10;

    let allSettled = true;
    let anySettledThisFrame = false;

    // Pre-calculate bin counts
    const binCounts = new Array(bins.length).fill(0);
    balls.forEach(b => {
      if (b.binIndex !== null && (b.settled || b.y > binTopY + 20)) {
        binCounts[b.binIndex]++;
      }
    });

    balls.forEach((ball, i) => {
      if (ball.settled) return;
      if (!ball.released) {
        allSettled = false;
        return;
      }
      allSettled = false;

      // Gravity
      ball.vy += GRAVITY;
      
      // Velocity dampening
      ball.vx *= FRICTION;
      ball.vy *= FRICTION;

      // Move
      ball.x += ball.vx;
      ball.y += ball.vy;

      // --- Funnel Wall Collisions ---
      if (ball.y < funnelBottomY) {
        // Diagonal walls
        const progress = Math.max(0, ball.y / funnelBottomY);
        const leftWallX = binStartX * progress;
        const rightWallX = width - (width - binEndX) * progress;
        
        if (ball.x < leftWallX + ball.radius) {
          ball.x = leftWallX + ball.radius;
          // Reflect velocity based on wall slope
          const slope = funnelBottomY / binStartX;
          const angle = Math.atan(slope);
          const nx = Math.cos(angle - Math.PI/2);
          const ny = Math.sin(angle - Math.PI/2);
          const dot = ball.vx * nx + ball.vy * ny;
          ball.vx = (ball.vx - 2 * dot * nx) * WALL_BOUNCE;
          ball.vy = (ball.vy - 2 * dot * ny) * WALL_BOUNCE;
          // Add a little extra kick away from wall
          ball.vx += 1.0;
        } else if (ball.x > rightWallX - ball.radius) {
          ball.x = rightWallX - ball.radius;
          // Reflect velocity
          const slope = funnelBottomY / (binEndX - width);
          const angle = Math.atan(slope);
          const nx = Math.cos(angle + Math.PI/2);
          const ny = Math.sin(angle + Math.PI/2);
          const dot = ball.vx * nx + ball.vy * ny;
          ball.vx = (ball.vx - 2 * dot * nx) * WALL_BOUNCE;
          ball.vy = (ball.vy - 2 * dot * ny) * WALL_BOUNCE;
          // Add a little extra kick away from wall
          ball.vx -= 1.0;
        }
      } else {
        // Vertical walls & Bin separators
        if (ball.x < binStartX + ball.radius) {
          ball.x = binStartX + ball.radius;
          ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
        } else if (ball.x > binEndX - ball.radius) {
          ball.x = binEndX - ball.radius;
          ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
        }

        // Inner separators (Solid with rounded caps)
        for (let j = 1; j < bins.length; j++) {
          const sepX = binStartX + j * binWidth;
          
          // Check collision with the vertical line
          if (Math.abs(ball.x - sepX) < ball.radius && ball.y > binTopY) {
            if (ball.x < sepX) {
              ball.x = sepX - ball.radius;
              ball.vx = -Math.abs(ball.vx) * WALL_BOUNCE;
            } else {
              ball.x = sepX + ball.radius;
              ball.vx = Math.abs(ball.vx) * WALL_BOUNCE;
            }
          }

          // Check collision with the top "cap" of the separator (rounded)
          const dx = ball.x - sepX;
          const dy = ball.y - binTopY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < ball.radius) {
            const angle = Math.atan2(dy, dx);
            ball.x = sepX + Math.cos(angle) * ball.radius;
            ball.y = binTopY + Math.sin(angle) * ball.radius;
            
            const nx = dx / dist;
            const ny = dy / dist;
            const dot = ball.vx * nx + ball.vy * ny;
            
            // More aggressive bounce off the cap to prevent balancing
            ball.vx = (ball.vx - 2 * dot * nx) * BOUNCE + (Math.random() - 0.5) * 6;
            ball.vy = (ball.vy - 2 * dot * ny) * BOUNCE - 3; // Stronger upward push
          }
        }
      }

      // Wall Collisions (Canvas edges)
      if (ball.x < ball.radius) {
        ball.x = ball.radius;
        ball.vx *= -WALL_BOUNCE;
      } else if (ball.x > width - ball.radius) {
        ball.x = width - ball.radius;
        ball.vx *= -WALL_BOUNCE;
      }

      // Peg Collisions
      pegs.forEach(peg => {
        const dx = ball.x - peg.x;
        const dy = ball.y - peg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = ball.radius + peg.radius;

        if (dist < minDist) {
          const angle = Math.atan2(dy, dx);
          ball.x = peg.x + Math.cos(angle) * minDist;
          ball.y = peg.y + Math.sin(angle) * minDist;
          
          const normalX = dx / dist;
          const normalY = dy / dist;
          const dot = ball.vx * normalX + ball.vy * normalY;
          ball.vx = (ball.vx - 2 * dot * normalX) * BOUNCE;
          ball.vy = (ball.vy - 2 * dot * normalY) * BOUNCE;
          
          // Add randomness on peg hit
          ball.vx += (Math.random() - 0.5) * 1.5;
          ball.vy += (Math.random() - 0.5) * 0.5;
        }
      });

      // Ball-Ball Collisions (Elastic)
      for (let j = 0; j < balls.length; j++) {
        if (i === j) continue;
        const other = balls[j];
        if (!other.released) continue;
        
        // If both are falling, only handle once (when i < j)
        if (!other.settled && i > j) continue;

        const dx = other.x - ball.x;
        const dy = other.y - ball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = ball.radius + other.radius;

        if (dist < minDist) {
          const angle = Math.atan2(dy, dx);
          const nx = Math.cos(angle);
          const ny = Math.sin(angle);
          
          // Resolve overlap
          const overlap = minDist - dist;
          if (other.settled) {
            ball.x -= nx * overlap;
            ball.y -= ny * overlap;
          } else {
            ball.x -= nx * overlap * 0.5;
            ball.y -= ny * overlap * 0.5;
            other.x += nx * overlap * 0.5;
            other.y += ny * overlap * 0.5;
          }

          // Relative velocity
          const rvx = (other.settled ? 0 : other.vx) - ball.vx;
          const rvy = (other.settled ? 0 : other.vy) - ball.vy;
          const velAlongNormal = rvx * nx + rvy * ny;

          // Only collide if they are moving towards each other
          if (velAlongNormal < 0) {
            const impulse = -(1 + BOUNCE) * velAlongNormal;
            if (other.settled) {
              ball.vx -= impulse * nx;
              ball.vy -= impulse * ny;
            } else {
              const impulseX = impulse * nx * 0.5;
              const impulseY = impulse * ny * 0.5;
              ball.vx -= impulseX;
              ball.vy -= impulseY;
              other.vx += impulseX;
              other.vy += impulseY;
            }
          }
        }
      }

      // Bin Entry & Settling
      // A ball must be physically inside the bin area to settle
      if (ball.y > binTopY) {
        const bIdx = Math.min(bins.length - 1, Math.max(0, Math.floor((ball.x - binStartX) / binWidth)));
        ball.binIndex = bIdx;
        
        const bin = bins[bIdx];
        const binCenterX = binStartX + bIdx * binWidth + binWidth / 2;
        
        // Capacity logic: If bin is full, bounce off the "lid"
        const assignedCount = binCounts[bIdx];
        if (assignedCount >= bin.maxCapacity && ball.y < binTopY + 10) {
          ball.y = binTopY - ball.radius - 2;
          ball.vy = -Math.abs(ball.vy) * 0.4 - 0.5; 
          // Push towards the nearest non-full bin
          let pushDir = (ball.x < binCenterX ? -1 : 1);
          if (bIdx === 0) pushDir = 1;
          if (bIdx === bins.length - 1) pushDir = -1;
          
          ball.vx = pushDir * 5 + (Math.random() - 0.5) * 3; 
          ball.binIndex = null;
          ball.stuckTimer = 0;
          return;
        }

        // Help ball enter bin center - soft force
        ball.vx += (binCenterX - ball.x) * 0.05;

        // Floor collision
        if (ball.y > floorY - ball.radius) {
          ball.y = floorY - ball.radius;
          ball.vy = Math.min(0, ball.vy);
          ball.vx *= BIN_FRICTION;
        }

        // Settle logic - Must be slow, supported, AND physically inside the bin
        const isSlow = Math.abs(ball.vx) < SNAP_THRESHOLD && Math.abs(ball.vy) < SNAP_THRESHOLD;
        const isVerySlowY = Math.abs(ball.vy) < 0.05;
        const isDeepInBin = ball.y > binTopY + ball.radius;
        const isSupported = ball.y > floorY - ball.radius - 2 || 
                           balls.some(other => other !== ball && other.settled && 
                                      other.binIndex === ball.binIndex &&
                                      Math.abs(other.x - ball.x) < ball.radius * 1.5 &&
                                      ball.y < other.y && 
                                      Math.abs(other.y - ball.y) < ball.radius * 2 + 5);

        if (isDeepInBin && (isSlow || (isVerySlowY && Math.abs(ball.vx) < 1.0)) && isSupported) {
          ball.stuckTimer++;
          if (ball.stuckTimer > 10) { // Increased wait time for more natural settling
            if (!ball.settled) {
              ball.settled = true;
              ball.vx = 0;
              ball.vy = 0;
              ball.x = binCenterX;
              bin.currentCount++;
              anySettledThisFrame = true;
            }
          }
        } else {
          ball.stuckTimer = 0;
          
          // Forced settle ONLY if deep inside bin and truly stuck for a long time
          if (ball.y > binTopY + ball.radius * 2) {
            ball.inBinTimer = (ball.inBinTimer || 0) + 1;
            if (ball.inBinTimer > 300) { // 5 seconds - very conservative
              ball.settled = true;
              ball.vx = 0;
              ball.vy = 0;
              ball.x = binCenterX;
              bin.currentCount++;
              anySettledThisFrame = true;
            }
          } else {
            ball.inBinTimer = 0;
          }

          // Tiny nudge inside bins
          if (!ball.settled) {
            ball.vx += (Math.random() - 0.5) * 0.05;
          }
        }
      }

      // Anti-stuck / Nudge for balls balancing ON TOP of bins
      if (!ball.settled) {
        // If ball is just above the bins and moving slowly, it's likely stuck on a separator or full bin
        const isNearTop = ball.y > binTopY - 40 && ball.y <= binTopY + 5;
        const isSlow = Math.abs(ball.vx) < 0.3 && Math.abs(ball.vy) < 0.3;

        if (isNearTop && isSlow) {
          ball.stuckTimer++;
          if (ball.stuckTimer > 45) { // Give it more time to fall naturally
            ball.vx += (Math.random() - 0.5) * 8.0; // Stronger kick
            ball.vy -= 2.5; // Bigger hop
            ball.stuckTimer = 0;
          }
        } else if (ball.y < binTopY - 40) {
          // Normal anti-stuck for pegs
          if (Math.abs(ball.vx) < 0.1 && Math.abs(ball.vy) < 0.1) {
            ball.stuckTimer++;
            if (ball.stuckTimer > STUCK_THRESHOLD) {
              ball.vx += (Math.random() - 0.5) * 5;
              ball.vy -= 2;
              ball.stuckTimer = 0;
            }
          } else {
            ball.stuckTimer = 0;
          }
        }
      }
    });

    // Batch update groups once per frame if any ball settled
    if (anySettledThisFrame || (Date.now() - lastGroupUpdateRef.current > 500 && isSimulatingRef.current)) {
      lastGroupUpdateRef.current = Date.now();
      setGroups(prev => {
        const next = [...prev];
        const binBallsMap = new Map();
        
        ballsRef.current.forEach(b => {
          if (b.binIndex !== null) {
            if (!binBallsMap.has(b.binIndex)) binBallsMap.set(b.binIndex, []);
            binBallsMap.get(b.binIndex).push(b);
          }
        });

        bins.forEach((bin, bIdx) => {
          const binBalls = (binBallsMap.get(bIdx) || [])
            .sort((a, b) => b.y - a.y);
          next[bIdx] = {
            ...next[bIdx],
            students: binBalls.map(b => b.student.name)
          };
        });
        return next;
      });
    }

    // Global timeout to prevent infinite simulation
    if (isSimulatingRef.current && Date.now() - simulationStartTimeRef.current > 30000) {
      balls.forEach(b => {
        if (b.released && !b.settled) {
          b.settled = true;
          b.vx = 0;
          b.vy = 0;
          // If above bins, try to find a bin
          if (b.binIndex === null) {
            const bIdx = Math.min(bins.length - 1, Math.max(0, Math.floor((b.x - binStartX) / binWidth)));
            b.binIndex = bIdx;
            b.x = binStartX + bIdx * binWidth + binWidth / 2;
          } else {
            b.x = binStartX + b.binIndex * binWidth + binWidth / 2;
          }
          if (b.binIndex !== null) bins[b.binIndex].currentCount++;
        }
      });
      allSettled = true;
      anySettledThisFrame = true;
    }

    if (allSettled && balls.length > 0) {
      isSimulatingRef.current = false;
      setIsSimulating(false);
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // Calculate Dynamic Zoom
    const activeBalls = ballsRef.current.filter(b => b.released && !b.settled);
    let targetScale = 1;
    let targetX = width / 2;
    let targetY = height / 2;

    if (isManualZoom) {
      const balls = ballsRef.current;
      if (balls.length > 0) {
        let avgX = 0, avgY = 0;
        let count = 0;
        balls.forEach(b => {
          if (!b.settled) {
            avgX += b.x;
            avgY += b.y;
            count++;
          }
        });
        if (count > 0) {
          targetX = avgX / count;
          targetY = avgY / count;
        } else {
          // If all settled, focus on bins
          targetX = width / 2;
          targetY = height - 100;
        }
      }
      targetScale = 1.8;
    } else if (activeBalls.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      activeBalls.forEach(b => {
        minX = Math.min(minX, b.x);
        maxX = Math.max(maxX, b.x);
        minY = Math.min(minY, b.y);
        maxY = Math.max(maxY, b.y);
      });

      const padding = 120;
      const contentWidth = (maxX - minX) + padding * 2;
      const contentHeight = (maxY - minY) + padding * 2;
      
      targetScale = Math.min(1.5, Math.max(0.5, Math.min(width / contentWidth, height / contentHeight)));
      targetX = (minX + maxX) / 2;
      targetY = (minY + maxY) / 2;
    } else if (ballsRef.current.length > 0 && ballsRef.current.every(b => b.settled)) {
      targetScale = 2.2; // Zoom in even more when all settled
      targetX = width / 2;
      targetY = height - 100;
    } else {
      // Show whole board initially
      targetScale = 0.8;
      targetX = width / 2;
      targetY = height / 2;
    }

    cameraRef.current.scale += (targetScale - cameraRef.current.scale) * 0.03;
    cameraRef.current.x += (targetX - cameraRef.current.x) * 0.03;
    cameraRef.current.y += (targetY - cameraRef.current.y) * 0.03;

    if (isFirstFrameRef.current) {
      cameraRef.current = { x: targetX, y: targetY, scale: targetScale };
      isFirstFrameRef.current = false;
    }

    ctx.fillStyle = '#f8fafc'; // Very light grey background
    ctx.fillRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(cameraRef.current.scale, cameraRef.current.scale);
    ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

    const binWidth = BALL_RADIUS * 2.2;
    const totalBinsWidth = binsRef.current.length * binWidth;
    const binStartX = Math.floor((width - totalBinsWidth) / 2);
    const binHeight = maxStudentsPerGroup * BALL_RADIUS * 2 + 15;
    const binTopY = height - binHeight;
    const funnelBottomY = binTopY;

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Left funnel wall
    ctx.moveTo(0, 0);
    ctx.lineTo(binStartX, funnelBottomY);
    ctx.lineTo(binStartX, height - 10);
    
    // Right funnel wall
    ctx.moveTo(width, 0);
    ctx.lineTo(binStartX + totalBinsWidth, funnelBottomY);
    ctx.lineTo(binStartX + totalBinsWidth, height - 10);
    ctx.stroke();

    // Draw Pegs (Small grey dots)
    ctx.fillStyle = '#cbd5e1';
    pegsRef.current.forEach(peg => {
      ctx.beginPath();
      ctx.arc(peg.x, peg.y, peg.radius, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw Bins
    binsRef.current.forEach((bin, i) => {
      const x = binStartX + i * binWidth;
      bin.x = x;
      bin.width = binWidth;

      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (i > 0) {
        ctx.moveTo(x, binTopY);
        ctx.lineTo(x, height - 10);
        ctx.stroke();
      }

      // Capacity Indicator
      const fillPct = bin.currentCount / bin.maxCapacity;
      ctx.fillStyle = fillPct >= 1 ? 'rgba(239, 68, 68, 0.05)' : 'transparent';
      ctx.fillRect(x + 1, binTopY + 1, binWidth - 2, (height - 10) - binTopY - 1);

      // Bin Number
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 24px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(`${i + 1}`, x + binWidth / 2, height - 30);
    });

    // Draw Bin Bottom Line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(binStartX, height - 10);
    ctx.lineTo(binStartX + totalBinsWidth, height - 10);
    ctx.stroke();

    // Draw Balls
    ballsRef.current.forEach(ball => {
      ctx.save();
      ctx.translate(ball.x, ball.y);
      
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 2;

      ctx.beginPath();
      ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = ball.color;
      ctx.fill();
      
      // Bubble highlight
      const grad = ctx.createRadialGradient(-ball.radius/3, -ball.radius/3, 1, 0, 0, ball.radius);
      grad.addColorStop(0, 'rgba(255,255,255,0.4)');
      grad.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      
      // Name label - Always visible
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // Outline for readability
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.strokeText(ball.student.name.substring(0, 7), 0, 0);
      ctx.fillText(ball.student.name.substring(0, 7), 0, 0);

      ctx.restore();
    });

    ctx.restore();
  };

  const loop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    updatePhysics();
    draw(ctx);
  };

  const loopRef = useRef(loop);
  loopRef.current = loop;

  useEffect(() => {
    const runLoop = () => {
      if (loopRef.current) loopRef.current();
      requestRef.current = requestAnimationFrame(runLoop);
    };
    requestRef.current = requestAnimationFrame(runLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const handleReset = () => {
    isSimulatingRef.current = false;
    setIsSimulating(false);
    setShowSettings(true);
    setGroups(Array.from({ length: calculatedGroupCount }, (_, i) => ({ id: i + 1, students: [] })));
    
    // Reset balls to funnel
    const canvas = canvasRef.current;
    if (canvas) {
      const width = canvas.width;
      const ballsPerRow = Math.max(1, Math.ceil(students.length / 2));
      const spacing = BALL_RADIUS * 2.4;
      
      ballsRef.current = students.map((s, i) => {
        const row = Math.floor(i / ballsPerRow);
        const col = i % ballsPerRow;
        const rowCount = Math.min(ballsPerRow, students.length - row * ballsPerRow);
        const rowWidth = (rowCount - 1) * spacing;
        const rowStartX = (width - rowWidth) / 2;

        return {
          x: rowStartX + col * spacing,
          y: 20 + row * spacing,
          vx: 0,
          vy: 0,
          radius: BALL_RADIUS,
          student: s,
          settled: false,
          released: false,
          binIndex: null,
          stuckTimer: 0,
          color: s.color
        };
      });
    }

    // Reset bins
    binsRef.current.forEach(bin => {
      bin.currentCount = 0;
    });

    const width = canvas.width;
    const height = canvas.height;
    cameraRef.current = { x: width / 2, y: height / 2, scale: 0.8 };
    setIsManualZoom(false);
  };

  const handleShuffle = () => {
    const lines = namesText.split('\n').filter(l => l.trim() !== '');
    const shuffled = [...lines].sort(() => Math.random() - 0.5);
    setNamesText(shuffled.join('\n'));
  };

  const copyToClipboard = () => {
    const text = groups
      .map(g => `Gruppe ${g.id}:\n${g.students.join('\n')}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* --- Left Panel --- */}
      <div className="w-full md:w-96 bg-white border-r border-slate-200 flex flex-col shadow-xl z-10">
        <div className="p-4 border-bottom border-slate-100 bg-white">
          <div className="flex items-center gap-3">
            <a href="https://skolechips.dk" target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
              <img src="https://i.imgur.com/lYK7DT3.png" alt="Skolechips Logo" className="w-10 h-10 object-contain" />
            </a>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Gruppepachinko
            </h1>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 1, height: 'auto' }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                {/* Names Input */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex justify-between">
                    Elevnavne
                    <span className="text-slate-400 font-normal">{students.length} elever</span>
                  </label>
                  <textarea
                    className="w-full h-48 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all resize-none font-medium"
                    placeholder="Indtast navne her...&#10;Navn 1&#10;Navn 2"
                    value={namesText}
                    onChange={(e) => setNamesText(e.target.value)}
                  />
                </div>

                {/* Settings Toggle */}
                <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                    <button
                      onClick={() => setMode('count')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${mode === 'count' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      Antal grupper
                    </button>
                    <button
                      onClick={() => setMode('size')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${mode === 'size' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                      Elever pr. gruppe
                    </button>
                  </div>

                  <div className="space-y-1">
                    <input
                      type="number"
                      min="1"
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-center font-bold text-lg focus:ring-2 focus:ring-emerald-500"
                      value={targetValue}
                      onChange={(e) => setTargetValue(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <p className="text-[10px] text-center text-slate-400 italic">
                      {mode === 'count' 
                        ? `Dette vil skabe ${targetValue} grupper` 
                        : `Dette vil skabe ca. ${calculatedGroupCount} grupper`}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            {showSettings ? (
              <>
                <button
                  onClick={handleShuffle}
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-95"
                >
                  <Shuffle className="w-4 h-4" />
                  Bland
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center justify-center gap-2 py-3 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  Nulstil
                </button>
                <button
                  disabled={isSimulating || students.length === 0}
                  onClick={initSimulation}
                  className="col-span-2 flex items-center justify-center gap-2 py-4 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none active:scale-95"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Start
                </button>
              </>
            ) : (
              <button
                onClick={handleReset}
                className="col-span-2 flex items-center justify-center gap-2 py-4 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 active:scale-95"
              >
                <RotateCcw className="w-5 h-5" />
                Nulstil
              </button>
            )}
          </div>

          {/* Group Results List */}
          <ResultsList 
            groups={groups} 
            copied={copied} 
            onCopy={copyToClipboard} 
          />
        </div>
      </div>

      {/* --- Right Panel (Canvas) --- */}
      <div ref={containerRef} className="flex-1 relative bg-slate-50 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
        />
        
        {/* Zoom Toggle */}
        {showSettings && (
          <button
            onClick={() => setIsManualZoom(!isManualZoom)}
            className={`absolute top-6 right-6 z-20 flex items-center gap-2 py-2 px-4 rounded-xl font-bold transition-all shadow-lg border ${
              isManualZoom 
                ? 'bg-emerald-600 text-white border-emerald-500' 
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {isManualZoom ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isManualZoom ? 'Zoom ud' : 'Se navne'}
          </button>
        )}
        
        {/* Legend / Status */}
        {isSimulating && !isManualZoom && (
          <div className="absolute top-6 right-6 bg-white/80 backdrop-blur-md border border-slate-200 p-4 rounded-2xl shadow-xl">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Status</div>
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {students.slice(0, 3).map((s, i) => (
                  <div key={i} className="w-6 h-6 rounded-full border-2 border-white" style={{ backgroundColor: s.color }} />
                ))}
              </div>
              <div className="text-sm font-bold text-slate-700">
                {ballsRef.current.filter(b => b.settled).length} / {students.length} landet
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
