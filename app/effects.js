/**
 * Quantum Council — Visual Effects System
 * Particle system, cursor effects, and ambient animations
 */

(function() {
  'use strict';

  // ========================================
  // PARTICLE SYSTEM
  // ========================================
  
  class ParticleSystem {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = [];
      this.maxParticles = 50;
      this.mouseX = 0;
      this.mouseY = 0;
      this.isActive = true;
      
      this.resize();
      this.initParticles();
      this.bindEvents();
      this.animate();
    }

    resize() {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    }

    initParticles() {
      this.particles = [];
      for (let i = 0; i < this.maxParticles; i++) {
        this.particles.push(this.createParticle());
      }
    }

    createParticle() {
      return {
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3 - 0.1,
        opacity: Math.random() * 0.5 + 0.1,
        color: this.getRandomColor(),
        pulse: Math.random() * Math.PI * 2
      };
    }

    getRandomColor() {
      const colors = [
        '184, 41, 221',   // Purple
        '0, 217, 255',    // Cyan
        '255, 215, 0',    // Gold
        '255, 107, 157',  // Rose
        '0, 255, 163'     // Emerald
      ];
      return colors[Math.floor(Math.random() * colors.length)];
    }

    bindEvents() {
      window.addEventListener('resize', () => this.resize());
      
      // Track mouse for subtle interaction
      document.addEventListener('mousemove', (e) => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
      }, { passive: true });

      // Respect reduced motion preference
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mediaQuery.matches) {
        this.isActive = false;
      }
      mediaQuery.addEventListener('change', (e) => {
        this.isActive = !e.matches;
      });
    }

    updateParticle(particle) {
      // Basic movement
      particle.x += particle.speedX;
      particle.y += particle.speedY;

      // Subtle mouse repulsion
      const dx = particle.x - this.mouseX;
      const dy = particle.y - this.mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 100) {
        const force = (100 - dist) / 100;
        particle.x += (dx / dist) * force * 0.5;
        particle.y += (dy / dist) * force * 0.5;
      }

      // Wrap around edges
      if (particle.x < 0) particle.x = this.canvas.width;
      if (particle.x > this.canvas.width) particle.x = 0;
      if (particle.y < 0) particle.y = this.canvas.height;
      if (particle.y > this.canvas.height) particle.y = 0;

      // Pulse opacity
      particle.pulse += 0.02;
      particle.currentOpacity = particle.opacity * (0.7 + 0.3 * Math.sin(particle.pulse));
    }

    drawParticle(particle) {
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${particle.color}, ${particle.currentOpacity})`;
      this.ctx.fill();

      // Subtle glow
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size * 3, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${particle.color}, ${particle.currentOpacity * 0.2})`;
      this.ctx.fill();
    }

    animate() {
      if (!this.isActive) {
        requestAnimationFrame(() => this.animate());
        return;
      }

      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.particles.forEach(particle => {
        this.updateParticle(particle);
        this.drawParticle(particle);
      });

      // Draw subtle connections between nearby particles
      this.drawConnections();

      requestAnimationFrame(() => this.animate());
    }

    drawConnections() {
      const maxDistance = 100;
      const maxConnections = 3;

      for (let i = 0; i < this.particles.length; i++) {
        let connections = 0;
        for (let j = i + 1; j < this.particles.length; j++) {
          if (connections >= maxConnections) break;

          const dx = this.particles[i].x - this.particles[j].x;
          const dy = this.particles[i].y - this.particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxDistance) {
            const opacity = (1 - dist / maxDistance) * 0.15;
            this.ctx.beginPath();
            this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
            this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
            this.ctx.strokeStyle = `rgba(184, 41, 221, ${opacity})`;
            this.ctx.lineWidth = 0.5;
            this.ctx.stroke();
            connections++;
          }
        }
      }
    }
  }

  // ========================================
  // AURORA BACKGROUND CONTROLLER
  // ========================================
  
  class AuroraBackground {
    constructor() {
      this.hue = 280; // Start with purple
      this.targetHue = 280;
      this.transitionSpeed = 0.5;
      this.intensity = 0.5;
      this.isActive = true;
      
      this.bindEvents();
      this.animate();
    }

    bindEvents() {
      // Respect reduced motion
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mediaQuery.matches) {
        this.isActive = false;
      }
    }

    setCouncilState(state) {
      // Change aurora colors based on council state
      const stateColors = {
        'resting': 280,      // Purple
        'convening': 200,    // Cyan
        'speaking': 320,     // Pink
        'synthesizing': 45,  // Gold
        'locked': 160        // Emerald
      };
      
      if (stateColors[state] !== undefined) {
        this.targetHue = stateColors[state];
      }
    }

    animate() {
      if (!this.isActive) return;

      // Smooth hue transition
      const diff = this.targetHue - this.hue;
      this.hue += diff * 0.02;

      // Update CSS custom property for dynamic theming
      document.documentElement.style.setProperty('--aurora-hue', this.hue);

      requestAnimationFrame(() => this.animate());
    }
  }

  // ========================================
  // CURSOR EFFECTS (Desktop only)
  // ========================================
  
  class CursorEffects {
    constructor() {
      this.trail = [];
      this.maxTrailLength = 10;
      this.isTouch = window.matchMedia('(pointer: coarse)').matches;
      
      if (!this.isTouch) {
        this.init();
      }
    }

    init() {
      document.addEventListener('mousemove', (e) => {
        this.addTrailPoint(e.clientX, e.clientY);
      }, { passive: true });

      this.animate();
    }

    addTrailPoint(x, y) {
      this.trail.push({ x, y, opacity: 1 });
      if (this.trail.length > this.maxTrailLength) {
        this.trail.shift();
      }
    }

    animate() {
      // Fade trail
      this.trail.forEach((point, index) => {
        point.opacity -= 0.05;
        if (point.opacity <= 0) {
          this.trail.splice(index, 1);
        }
      });

      // Draw trail via CSS custom properties for glow positions
      if (this.trail.length > 0) {
        const latest = this.trail[this.trail.length - 1];
        document.documentElement.style.setProperty('--cursor-x', `${latest.x}px`);
        document.documentElement.style.setProperty('--cursor-y', `${latest.y}px`);
      }

      requestAnimationFrame(() => this.animate());
    }
  }

  // ========================================
  // COUNCIL STATE VISUALIZER
  // ========================================
  
  class CouncilStateVisualizer {
    constructor() {
      this.currentState = 'resting';
      this.background = new AuroraBackground();
    }

    setState(state) {
      if (this.currentState === state) return;
      
      this.currentState = state;
      this.background.setCouncilState(state);
      
      // Update UI elements based on state
      const body = document.body;
      body.classList.remove('state-resting', 'state-convening', 'state-speaking', 'state-synthesizing');
      body.classList.add(`state-${state}`);

      // Emit custom event for other components
      window.dispatchEvent(new CustomEvent('council-state-change', { 
        detail: { state, previousState: this.currentState } 
      }));
    }
  }

  // ========================================
  // INITIALIZATION
  // ========================================
  
  function initEffects() {
    // Create particle canvas
    const existingCanvas = document.getElementById('particle-canvas');
    if (existingCanvas) existingCanvas.remove();

    const canvas = document.createElement('canvas');
    canvas.id = 'particle-canvas';
    canvas.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 1;
    `;
    document.body.insertBefore(canvas, document.body.firstChild);

    // Initialize systems
    const particles = new ParticleSystem(canvas);
    const cursor = new CursorEffects();
    const councilState = new CouncilStateVisualizer();

    // Expose to global scope for app integration
    window.QuantumEffects = {
      particles,
      cursor,
      councilState,
      setCouncilState: (state) => councilState.setState(state)
    };

    console.log('🌌 Quantum Council effects initialized');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEffects);
  } else {
    initEffects();
  }
})();
