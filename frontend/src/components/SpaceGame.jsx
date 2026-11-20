import React, { useEffect, useRef, useState } from 'react';


const SpaceGame = ({ ticketStatus }) => {
  const canvasRef = useRef(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  
  const moveState = useRef({ left: false, right: false });
  const player = useRef({ x: 125, y: 300, w: 30, h: 30, speed: 7 });
  const bullets = useRef([]);
  const enemies = useRef([]);

  
  const handleRetry = () => {
    player.current = { x: 125, y: 300, w: 30, h: 30, speed: 7 };
    bullets.current = [];
    enemies.current = [];
    setScore(0);
    setGameOver(false);
  };

  
  const handleFire = (e) => {
    if (e) e.preventDefault(); // Prevents zoom/scroll on mobile
    if (gameOver) return;
    if (bullets.current.length < 5) {
      bullets.current.push({ 
        x: player.current.x + (player.current.w / 2) - 2, 
        y: player.current.y, 
        w: 4, 
        h: 10 
      });
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const update = () => {
      if (gameOver || ticketStatus === 'Served') return;

      
      if (moveState.current.left && player.current.x > 0) player.current.x -= player.current.speed;
      if (moveState.current.right && player.current.x < canvas.width - player.current.w) player.current.x += player.current.speed;

      
      bullets.current.forEach((b, i) => {
        b.y -= 8;
        if (b.y < 0) bullets.current.splice(i, 1);
      });

      
      if (Math.random() < 0.03) {
        enemies.current.push({ x: Math.random() * (canvas.width - 25), y: -30, w: 25, h: 25 });
      }

      
      enemies.current.forEach((en, i) => {
        en.y += 3;
        if (en.y + en.h > player.current.y && 
            en.x < player.current.x + player.current.w && 
            en.x + en.w > player.current.x) {
          setGameOver(true);
        }

        bullets.current.forEach((b, bi) => {
          if (b.x < en.x + en.w && b.x + b.w > en.x && b.y < en.y + en.h && b.y + b.h > en.y) {
            enemies.current.splice(i, 1);
            bullets.current.splice(bi, 1);
            setScore(s => s + 10);
          }
        });

        if (en.y > canvas.height) enemies.current.splice(i, 1);
      });
    };

    const draw = () => {
      ctx.fillStyle = '#9bbc0f'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw V-Ship
      ctx.fillStyle = '#0f380f';
      ctx.beginPath();
      ctx.moveTo(player.current.x, player.current.y + player.current.h);
      ctx.lineTo(player.current.x + player.current.w / 2, player.current.y);
      ctx.lineTo(player.current.x + player.current.w, player.current.y + player.current.h);
      ctx.lineTo(player.current.x + player.current.w / 2, player.current.y + player.current.h - 8);
      ctx.fill();

      // Draw Bullets
      ctx.fillStyle = '#306230';
      bullets.current.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));

      // Draw Enemies
      ctx.fillStyle = '#0f380f';
      enemies.current.forEach(en => {
        ctx.beginPath();
        ctx.moveTo(en.x, en.y);
        ctx.lineTo(en.x + en.w, en.y);
        ctx.lineTo(en.x + en.w / 2, en.y + en.h);
        ctx.fill();
      });
    };

    const render = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameOver, ticketStatus]);

  return (
    <div className="gameboy-shell">
      <div className="lcd-screen">
        <div className="score-text">SCORE: {score}</div>
        <canvas ref={canvasRef} width={280} height={350} />
        
        {gameOver && (
          <div className="over-msg">
            <h3>GAME OVER</h3>
            <button className="retry-btn" onClick={handleRetry}>RETRY</button>
          </div>
        )}
      </div>

      <div className="gb-controls">
        <div className="d-pad">
          <button 
            className="btn-left"
            onTouchStart={() => (moveState.current.left = true)} 
            onTouchEnd={() => (moveState.current.left = false)}
          >◀</button>
          <button 
            className="btn-right"
            onTouchStart={() => (moveState.current.right = true)} 
            onTouchEnd={() => (moveState.current.right = false)}
          >▶</button>
        </div>
        
        <div className="a-btn-container">
          <button className="a-btn" onTouchStart={handleFire}>A</button>
          <small>FIRE</small>
        </div>
      </div>
    </div>
  );
};

export default SpaceGame;