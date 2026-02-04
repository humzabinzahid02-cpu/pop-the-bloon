'use client';

import React, { useEffect, useRef, useState } from 'react';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type BalloonType = 'normal' | 'star' | 'bomb' | 'golden';
type GameState = 'menu' | 'playing' | 'gameover';
type Difficulty = 'easy' | 'medium' | 'hard';

interface Balloon {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  type: BalloonType;
  popped: boolean;
  popTime?: number;
  rotation: number;
  rotationSpeed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface DifficultyConfig {
  baseSpeed: number;
  spawnInterval: number;
  bombChance: number;
  starChance: number;
  goldenChance: number;
  speedIncreaseRate: number;
  spawnDecreaseRate: number;
}

// ============================================================================
// GAME CONFIGURATION
// ============================================================================

const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    baseSpeed: 1.2,
    spawnInterval: 1800,
    bombChance: 0.05,
    starChance: 0.15,
    goldenChance: 0.08,
    speedIncreaseRate: 0.0005,
    spawnDecreaseRate: 0.98,
  },
  medium: {
    baseSpeed: 1.8,
    spawnInterval: 1400,
    bombChance: 0.12,
    starChance: 0.12,
    goldenChance: 0.06,
    speedIncreaseRate: 0.001,
    spawnDecreaseRate: 0.97,
  },
  hard: {
    baseSpeed: 2.5,
    spawnInterval: 1000,
    bombChance: 0.18,
    starChance: 0.10,
    goldenChance: 0.05,
    speedIncreaseRate: 0.0015,
    spawnDecreaseRate: 0.96,
  },
};

const BALLOON_COLORS = {
  normal: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'],
  star: '#FFD700',
  bomb: '#2C3E50',
  golden: '#FFC107',
};

const BONUS_DURATION = 8000; // 8 seconds
const BONUS_MULTIPLIER = 2;

// ============================================================================
// MAIN GAME COMPONENT
// ============================================================================

export default function PopTheBalloonGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const scoreRef = useRef<number>(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [highScores, setHighScores] = useState<Record<Difficulty, number>>({
    easy: 0,
    medium: 0,
    hard: 0,
  });

  // Game state refs (mutable, don't trigger re-renders)
  const gameRef = useRef({
    balloons: [] as Balloon[],
    particles: [] as Particle[],
    nextBalloonId: 0,
    lastSpawnTime: 0,
    currentSpawnInterval: 0,
    currentSpeed: 0,
    startTime: 0,
    bonusEndTime: 0,
    animationFrameId: 0,
    audioContext: null as AudioContext | null,
    isAudioReady: false,
    canvasWidth: 0,
    canvasHeight: 0,
  });

  // ============================================================================
  // AUDIO SYSTEM
  // ============================================================================

  const initAudio = () => {
    if (gameRef.current.audioContext) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      gameRef.current.audioContext = new AudioContext();
      gameRef.current.isAudioReady = true;
    } catch (e) {
      console.warn('Audio not supported');
    }
  };

  const playSound = (frequency: number, duration: number, type: OscillatorType = 'sine') => {
    if (!gameRef.current.audioContext || !gameRef.current.isAudioReady) return;
    
    try {
      const ctx = gameRef.current.audioContext;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.value = frequency;

      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (e) {
      // Silently fail if audio doesn't work
    }
  };

  const playSoundEffect = (type: BalloonType) => {
    switch (type) {
      case 'normal':
        playSound(523.25, 0.1, 'sine'); // C5
        break;
      case 'star':
        playSound(659.25, 0.15, 'triangle'); // E5
        playSound(783.99, 0.15, 'triangle'); // G5
        break;
      case 'golden':
        playSound(880, 0.2, 'square'); // A5
        playSound(1046.5, 0.2, 'square'); // C6
        break;
      case 'bomb':
        playSound(130.81, 0.3, 'sawtooth'); // C3
        break;
    }
  };

  // ============================================================================
  // PARTICLE SYSTEM
  // ============================================================================

  const createParticles = (x: number, y: number, color: string, count: number = 12) => {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 2 + Math.random() * 3;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: 0.5 + Math.random() * 0.5,
        color,
        size: 3 + Math.random() * 3,
      });
    }
    gameRef.current.particles.push(...particles);
  };

  // ============================================================================
  // BALLOON MANAGEMENT
  // ============================================================================

  const spawnBalloon = (canvas: HTMLCanvasElement) => {
    const config = DIFFICULTY_CONFIGS[difficulty];
    const game = gameRef.current;

    // Determine balloon type
    let type: BalloonType = 'normal';
    const rand = Math.random();
    
    if (rand < config.bombChance) {
      type = 'bomb';
    } else if (rand < config.bombChance + config.goldenChance) {
      type = 'golden';
    } else if (rand < config.bombChance + config.goldenChance + config.starChance) {
      type = 'star';
    }

    // Scale balloon size based on screen size - responsive sizing
    const baseRadius = Math.min(canvas.width, canvas.height) * 0.05;
    const radius = baseRadius * (0.8 + Math.random() * 0.4);

    const balloon: Balloon = {
      id: game.nextBalloonId++,
      x: radius + Math.random() * (canvas.width - radius * 2),
      y: canvas.height + radius,
      vx: (Math.random() - 0.5) * 0.8,
      vy: -game.currentSpeed * (0.8 + Math.random() * 0.4),
      radius,
      type,
      popped: false,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.05,
    };

    game.balloons.push(balloon);
  };

  const popBalloon = (balloon: Balloon) => {
    if (balloon.popped) return;

    balloon.popped = true;
    balloon.popTime = Date.now();

    playSoundEffect(balloon.type);

    // Create particles
    const color = balloon.type === 'normal' 
      ? BALLOON_COLORS.normal[Math.floor(Math.random() * BALLOON_COLORS.normal.length)]
      : BALLOON_COLORS[balloon.type];
    createParticles(balloon.x, balloon.y, color, balloon.type === 'star' ? 20 : 15);

    // Handle scoring and effects
    const isBonus = Date.now() < gameRef.current.bonusEndTime;
    const multiplier = isBonus ? BONUS_MULTIPLIER : 1;

    switch (balloon.type) {
      case 'normal':
        setScore(s => {
          const next = s + 1 * multiplier;
          scoreRef.current = next;
          return next;
        });
        break;
      case 'star':
        setScore(s => {
          const next = s + 5 * multiplier;
          scoreRef.current = next;
          return next;
        });
        break;
      case 'golden':
        setScore(s => {
          const next = s + 3 * multiplier;
          scoreRef.current = next;
          return next;
        });
        gameRef.current.bonusEndTime = Date.now() + BONUS_DURATION;
        break;
      case 'bomb':
        endGame();
        break;
    }
  };

  // ============================================================================
  // INPUT HANDLING
  // ============================================================================

  const handleCanvasClick = (e: MouseEvent | TouchEvent) => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    let clientX: number, clientY: number;

    if (e instanceof MouseEvent) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      e.preventDefault();
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    // Convert to canvas coordinates accounting for DPR
    const x = (clientX - rect.left) * dpr;
    const y = (clientY - rect.top) * dpr;

    // Check collision with balloons (reverse order to prioritize front balloons)
    for (let i = gameRef.current.balloons.length - 1; i >= 0; i--) {
      const balloon = gameRef.current.balloons[i];
      if (balloon.popped) continue;

      const dx = x - balloon.x;
      const dy = y - balloon.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < balloon.radius) {
        popBalloon(balloon);
        break; // Only pop one balloon per click
      }
    }
  };

  // ============================================================================
  // GAME LOOP
  // ============================================================================

  const updateGame = (canvas: HTMLCanvasElement, deltaTime: number) => {
    const game = gameRef.current;
    const config = DIFFICULTY_CONFIGS[difficulty];
    const currentTime = Date.now();

    // Dynamic difficulty scaling
    const elapsedSeconds = (currentTime - game.startTime) / 1000;
    game.currentSpeed = config.baseSpeed + elapsedSeconds * config.speedIncreaseRate;
    game.currentSpawnInterval = Math.max(
      300,
      config.spawnInterval * Math.pow(config.spawnDecreaseRate, elapsedSeconds / 10)
    );

    // Spawn balloons
    if (currentTime - game.lastSpawnTime > game.currentSpawnInterval) {
      spawnBalloon(canvas);
      game.lastSpawnTime = currentTime;
    }

    // Update balloons
    game.balloons = game.balloons.filter(balloon => {
      if (balloon.popped && currentTime - (balloon.popTime || 0) > 300) {
        return false; // Remove popped balloons after animation
      }

      balloon.x += balloon.vx;
      balloon.y += balloon.vy;
      balloon.rotation += balloon.rotationSpeed;

      // Remove balloons that float off screen
      if (balloon.y + balloon.radius < 0) {
        return false;
      }

      return true;
    });

    // Update particles
    game.particles = game.particles.filter(particle => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.15; // Gravity
      particle.life -= deltaTime / 1000;

      return particle.life > 0;
    });
  };

  const drawBalloon = (ctx: CanvasRenderingContext2D, balloon: Balloon) => {
    if (balloon.popped) {
      // Fade out animation
      const fadeProgress = Math.min(1, (Date.now() - (balloon.popTime || 0)) / 300);
      ctx.globalAlpha = 1 - fadeProgress;
    }

    ctx.save();
    ctx.translate(balloon.x, balloon.y);
    ctx.rotate(balloon.rotation);

    // Draw balloon body
    let color: string;
    if (balloon.type === 'normal') {
      color = BALLOON_COLORS.normal[balloon.id % BALLOON_COLORS.normal.length];
    } else {
      color = BALLOON_COLORS[balloon.type];
    }

    // Balloon gradient
    const gradient = ctx.createRadialGradient(
      -balloon.radius * 0.3,
      -balloon.radius * 0.3,
      balloon.radius * 0.1,
      0,
      0,
      balloon.radius
    );
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.7, color);
    gradient.addColorStop(1, adjustBrightness(color, -30));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, balloon.radius, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.ellipse(-balloon.radius * 0.25, -balloon.radius * 0.25, balloon.radius * 0.3, balloon.radius * 0.2, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();

    // String
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, balloon.radius);
    ctx.quadraticCurveTo(balloon.radius * 0.2, balloon.radius * 1.5, balloon.radius * 0.1, balloon.radius * 2);
    ctx.stroke();

    // Type indicator - scale font size with balloon
    ctx.font = `${balloon.radius * 0.8}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (balloon.type === 'star') {
      ctx.fillText('⭐', 0, 0);
    } else if (balloon.type === 'bomb') {
      ctx.fillText('💣', 0, 0);
    } else if (balloon.type === 'golden') {
      ctx.fillText('✨', 0, 0);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const drawParticle = (ctx: CanvasRenderingContext2D, particle: Particle) => {
    ctx.globalAlpha = particle.life / particle.maxLife;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  const render = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(1, '#E0F6FF');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw balloons
    gameRef.current.balloons.forEach(balloon => drawBalloon(ctx, balloon));

    // Draw particles
    gameRef.current.particles.forEach(particle => drawParticle(ctx, particle));

    // Draw UI
    drawUI(ctx, canvas);
  };

  const drawUI = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    // Responsive font sizing based on canvas dimensions
    const baseFontSize = Math.min(canvas.width, canvas.height) * 0.035;
    const fontSize = Math.max(16, Math.min(baseFontSize, 40));
    const padding = Math.max(10, canvas.width * 0.02);
    
    // Score
    const displayScore = scoreRef.current;
    ctx.font = `bold ${fontSize * 1.5}px Arial`;
    ctx.fillStyle = '#2C3E50';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(3, fontSize * 0.15);
    ctx.textAlign = 'left';
    ctx.strokeText(`Score: ${displayScore}`, padding, fontSize * 2);
    ctx.fillText(`Score: ${displayScore}`, padding, fontSize * 2);

    // Bonus indicator
    const bonusTimeLeft = gameRef.current.bonusEndTime - Date.now();
    if (bonusTimeLeft > 0) {
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.fillStyle = '#FFC107';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(2, fontSize * 0.1);
      const bonusText = `✨ BONUS x${BONUS_MULTIPLIER} (${Math.ceil(bonusTimeLeft / 1000)}s)`;
      ctx.strokeText(bonusText, padding, fontSize * 3.5);
      ctx.fillText(bonusText, padding, fontSize * 3.5);
    }

    // Difficulty
    ctx.font = `${fontSize * 0.8}px Arial`;
    ctx.fillStyle = '#34495E';
    ctx.textAlign = 'right';
    ctx.fillText(difficulty.toUpperCase(), canvas.width - padding, fontSize * 1.5);
  };

  const gameLoop = (currentTime: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || gameState !== 'playing') return;

    const deltaTime = 16; // Approximate 60 FPS

    updateGame(canvas, deltaTime);
    render(canvas, ctx);

    gameRef.current.animationFrameId = requestAnimationFrame(gameLoop);
  };

  // ============================================================================
  // GAME STATE MANAGEMENT
  // ============================================================================

  const startGame = () => {
    initAudio();
    
    const game = gameRef.current;
    const config = DIFFICULTY_CONFIGS[difficulty];
    
    game.balloons = [];
    game.particles = [];
    game.nextBalloonId = 0;
    game.lastSpawnTime = Date.now();
    game.currentSpawnInterval = config.spawnInterval;
    game.currentSpeed = config.baseSpeed;
    game.startTime = Date.now();
    game.bonusEndTime = 0;

    setScore(0);
    scoreRef.current = 0;
    setGameState('playing');
  };

  const endGame = () => {
    setGameState('gameover');
    
    // Update high score
    setHighScores(prev => {
      const newHighScores = { ...prev };
      if (score > newHighScores[difficulty]) {
        newHighScores[difficulty] = score;
        // Save to localStorage
        try {
          localStorage.setItem('balloonHighScores', JSON.stringify(newHighScores));
        } catch (e) {
          // Ignore localStorage errors
        }
      }
      return newHighScores;
    });

    if (gameRef.current.animationFrameId) {
      cancelAnimationFrame(gameRef.current.animationFrameId);
    }
  };

  const returnToMenu = () => {
    setGameState('menu');
  };

  // ============================================================================
  // CANVAS SETUP & RESIZE
  // ============================================================================

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    // Set canvas size to match container, accounting for DPR
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Store actual dimensions for game logic
    gameRef.current.canvasWidth = canvas.width;
    gameRef.current.canvasHeight = canvas.height;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // No need to scale context - we're working in device pixels
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    }
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    // Load high scores from localStorage
    try {
      const saved = localStorage.getItem('balloonHighScores');
      if (saved) {
        setHighScores(JSON.parse(saved));
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    resizeCanvas();
    
    const handleResize = () => {
      resizeCanvas();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Initial resize after a short delay to ensure proper layout
    const timeoutId = setTimeout(resizeCanvas, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (gameState === 'playing') {
      canvas.addEventListener('click', handleCanvasClick);
      canvas.addEventListener('touchstart', handleCanvasClick);
      gameRef.current.animationFrameId = requestAnimationFrame(gameLoop);

      return () => {
        canvas.removeEventListener('click', handleCanvasClick);
        canvas.removeEventListener('touchstart', handleCanvasClick);
        if (gameRef.current.animationFrameId) {
          cancelAnimationFrame(gameRef.current.animationFrameId);
        }
      };
    }
  }, [gameState, difficulty]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div ref={containerRef} style={styles.container}>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
      />

      {/* Menu Screen */}
      {gameState === 'menu' && (
        <div style={styles.overlay}>
          <div style={styles.menu}>
            <h1 style={styles.title}>🎈 Pop the Balloon</h1>
            
            <div style={styles.instructions}>
              <p style={styles.instructionText}>🎈 Normal Balloon = +1 point</p>
              <p style={styles.instructionText}>⭐ Star Balloon = +5 points</p>
              <p style={styles.instructionText}>✨ Golden Balloon = Bonus Mode!</p>
              <p style={styles.instructionText}>💣 Bomb = Game Over!</p>
            </div>

            <div style={styles.difficultySection}>
              <h2 style={styles.difficultyTitle}>Select Difficulty</h2>
              <div style={styles.difficultyButtons}>
                {(['easy', 'medium', 'hard'] as Difficulty[]).map(diff => (
                  <button
                    key={diff}
                    onClick={() => setDifficulty(diff)}
                    style={{
                      ...styles.difficultyButton,
                      ...(difficulty === diff ? styles.difficultyButtonActive : {}),
                    }}
                  >
                    {diff.toUpperCase()}
                    {highScores[diff] > 0 && (
                      <div style={styles.highScore}>Best: {highScores[diff]}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={startGame} style={styles.playButton}>
              Start Game
            </button>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState === 'gameover' && (
        <div style={styles.overlay}>
          <div style={styles.menu}>
            <h1 style={styles.gameOverTitle}>💥 Game Over!</h1>
            <p style={styles.finalScore}>Final Score: {score}</p>
            {score >= highScores[difficulty] && score > 0 && (
              <p style={styles.newHighScore}>🎉 New High Score!</p>
            )}
            {highScores[difficulty] > 0 && (
              <p style={styles.highScoreText}>
                Best ({difficulty}): {highScores[difficulty]}
              </p>
            )}
            
            <div style={styles.gameOverButtons}>
              <button onClick={startGame} style={styles.playButton}>
                Play Again
              </button>
              <button onClick={returnToMenu} style={styles.menuButton}>
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function adjustBrightness(color: string, amount: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ============================================================================
// RESPONSIVE STYLES
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#87CEEB',
    fontFamily: 'Arial, sans-serif',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
    touchAction: 'none',
    userSelect: 'none',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(5px)',
    padding: '20px',
    boxSizing: 'border-box',
  },
  menu: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 'clamp(20px, 5vw, 40px)',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 'clamp(1.8rem, 6vw, 3rem)',
    margin: '0 0 clamp(15px, 3vw, 30px) 0',
    color: '#2C3E50',
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.1)',
  },
  instructions: {
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    padding: 'clamp(15px, 3vw, 20px)',
    marginBottom: 'clamp(15px, 3vw, 30px)',
  },
  instructionText: {
    fontSize: 'clamp(0.9rem, 2.5vw, 1.1rem)',
    margin: '8px 0',
    color: '#34495E',
  },
  difficultySection: {
    marginBottom: 'clamp(15px, 3vw, 30px)',
  },
  difficultyTitle: {
    fontSize: 'clamp(1.2rem, 3.5vw, 1.5rem)',
    color: '#2C3E50',
    marginBottom: 15,
  },
  difficultyButtons: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  difficultyButton: {
    flex: '1',
    minWidth: 'clamp(80px, 25vw, 100px)',
    padding: 'clamp(12px, 2.5vw, 15px) clamp(15px, 3vw, 20px)',
    fontSize: 'clamp(0.85rem, 2.2vw, 1rem)',
    fontWeight: 'bold',
    border: '3px solid #BDC3C7',
    borderRadius: 10,
    backgroundColor: 'white',
    color: '#7F8C8D',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  difficultyButtonActive: {
    borderColor: '#3498DB',
    backgroundColor: '#3498DB',
    color: 'white',
    transform: 'scale(1.05)',
  },
  highScore: {
    fontSize: 'clamp(0.65rem, 1.8vw, 0.75rem)',
    marginTop: 5,
    opacity: 0.8,
  },
  playButton: {
    width: '100%',
    padding: 'clamp(15px, 3vw, 20px)',
    fontSize: 'clamp(1.1rem, 3vw, 1.5rem)',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: 10,
    backgroundColor: '#27AE60',
    color: 'white',
    cursor: 'pointer',
    transition: 'all 0.3s',
    boxShadow: '0 4px 15px rgba(39, 174, 96, 0.3)',
  },
  gameOverTitle: {
    fontSize: 'clamp(1.5rem, 5vw, 2.5rem)',
    margin: '0 0 20px 0',
    color: '#E74C3C',
  },
  finalScore: {
    fontSize: 'clamp(1.3rem, 4vw, 2rem)',
    margin: '20px 0',
    color: '#2C3E50',
    fontWeight: 'bold',
  },
  newHighScore: {
    fontSize: 'clamp(1rem, 3vw, 1.5rem)',
    color: '#F39C12',
    fontWeight: 'bold',
    margin: '10px 0',
  },
  highScoreText: {
    fontSize: 'clamp(0.95rem, 2.5vw, 1.2rem)',
    color: '#7F8C8D',
    margin: '10px 0 20px 0',
  },
  gameOverButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: 20,
  },
  menuButton: {
    width: '100%',
    padding: 'clamp(12px, 2.5vw, 15px)',
    fontSize: 'clamp(1rem, 2.5vw, 1.2rem)',
    fontWeight: 'bold',
    border: '2px solid #95A5A6',
    borderRadius: 10,
    backgroundColor: 'white',
    color: '#7F8C8D',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
};

// Add media query styles for larger screens
if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
  styles.gameOverButtons = {
    ...styles.gameOverButtons,
    flexDirection: 'row',
  };
}