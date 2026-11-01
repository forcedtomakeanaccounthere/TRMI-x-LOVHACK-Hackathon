import { cn } from "@/lib/utils";

// The /forgot-password illustration, in the hairline style: single thin strokes that draw themselves
// in (globals.css thread-draw, pathLength 1). A character going "shh" with a finger to the lips, a
// key on a looping thread that ties back to an open padlock, and three hand-drawn speech bubbles.
// Pure SVG and CSS, so it plays on the server-rendered page and respects reduced motion.

const draw = (delay: number) => ({ animationDelay: `${delay}s` });

function Stroke({
  d,
  delay,
  width = 1.25,
  className,
}: {
  d: string;
  delay: number;
  width?: number;
  className?: string;
}) {
  return (
    <path
      className={cn("animate-thread-draw", className)}
      style={draw(delay)}
      pathLength={1}
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

// A wobbly hand-drawn bubble around a line of text, with its tail pointing at the character.
function Bubble({
  children,
  className,
  delay,
  tail,
}: {
  children: React.ReactNode;
  className?: string;
  delay: number;
  tail: "left" | "right" | "down";
}) {
  const tails = {
    left: "M30 66 C 22 78 14 86 4 90 C 16 90 30 84 40 72",
    right: "M210 66 C 218 78 226 86 236 90 C 224 90 210 84 200 72",
    down: "M110 70 C 112 82 108 94 100 102 C 114 98 124 88 126 72",
  };
  return (
    <div className={cn("animate-thread-rise absolute", className)} style={draw(delay)}>
      <div className="animate-float-slow relative" style={{ animationDelay: `${-delay * 2}s` }}>
        {/* Stretched to the text it holds; the stroke stays a hairline however it stretches. */}
        <svg
          viewBox="0 0 240 104"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible text-foreground/70"
          aria-hidden
        >
          <path
            className="animate-thread-draw"
            style={draw(delay + 0.1)}
            pathLength={1}
            d="M24 12 C 70 4 170 2 214 12 C 236 18 238 52 228 62 C 214 74 120 72 40 70 C 14 68 4 52 8 32 C 10 20 16 14 24 12 Z"
            fill="color-mix(in oklab, var(--card) 70%, transparent)"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="animate-thread-draw"
            style={draw(delay + 0.5)}
            pathLength={1}
            d={tails[tail]}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <p className="relative px-6 pt-3 pb-9 text-center font-display text-[1.15rem] leading-tight whitespace-nowrap text-foreground italic md:text-[1.3rem]">
          {children}
        </p>
      </div>
    </div>
  );
}

export function SecretArt({ className }: { className?: string }) {
  return (
    <div className={cn("relative mx-auto aspect-[520/560] w-full max-w-[30rem]", className)}>
      <svg viewBox="0 0 520 560" className="absolute inset-0 size-full overflow-visible text-foreground" aria-hidden>
        <defs>
          <radialGradient id="secret-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--azure)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--azure)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="260" cy="330" r="190" fill="url(#secret-glow)" />

        {/* The thread: from the padlock, around in a loop, up to the key */}
        <Stroke
          delay={0.2}
          width={1}
          className="text-azure"
          d="M118 470 C 70 440 60 380 96 350 C 132 320 170 352 150 384 C 128 420 70 392 84 330 C 98 266 176 210 250 190 C 330 168 392 150 410 112"
        />

        {/* Open padlock */}
        <Stroke
          delay={0.4}
          d="M92 470 L 150 470 C 156 470 160 474 160 480 L 160 528 C 160 534 156 538 150 538 L 92 538 C 86 538 82 534 82 528 L 82 480 C 82 474 86 470 92 470 Z"
        />
        <Stroke delay={0.7} d="M98 470 L 98 444 C 98 420 132 418 134 440 L 134 446" />
        {/* Keyhole */}
        <Stroke
          delay={0.9}
          d="M121 490 C 126 490 128 494 128 497 C 128 500 125 502 123 503 L 125 514 L 117 514 L 119 503 C 117 502 114 500 114 497 C 114 494 116 490 121 490 Z"
        />

        {/* Key */}
        <Stroke delay={0.6} d="M424 96 C 440 84 462 92 464 110 C 466 128 448 140 432 132 C 418 126 414 106 424 96 Z" />
        <Stroke delay={0.8} d="M432 132 L 386 196 M398 180 L 410 190 M406 168 L 420 178" />

        {/* Head */}
        <Stroke
          delay={0.3}
          width={1.4}
          d="M260 214 C 330 212 366 262 364 324 C 362 392 318 430 258 430 C 196 430 154 388 156 322 C 158 262 196 216 260 214 Z"
        />
        {/* Hair tuft */}
        <Stroke
          delay={0.9}
          d="M236 220 C 238 204 250 196 262 200 C 254 206 254 214 262 216 C 270 206 286 206 290 220"
        />
        {/* Happy closed eyes */}
        <Stroke delay={1.1} width={1.5} d="M212 312 C 220 302 234 302 242 312" />
        <Stroke delay={1.2} width={1.5} d="M282 312 C 290 302 304 302 312 312" />
        {/* Blush */}
        <circle
          className="animate-thread-rise"
          style={draw(1.5)}
          cx="210"
          cy="340"
          r="12"
          fill="var(--azure)"
          fillOpacity="0.16"
        />
        <circle
          className="animate-thread-rise"
          style={draw(1.5)}
          cx="314"
          cy="340"
          r="12"
          fill="var(--azure)"
          fillOpacity="0.16"
        />
        {/* Mouth peeking out on both sides of the finger */}
        <Stroke delay={1.3} d="M238 364 C 244 370 250 372 254 372 M272 372 C 276 372 282 370 288 364" />
        {/* Finger to the lips, and the hand below */}
        <Stroke delay={1.4} width={1.4} d="M254 400 L 254 352 C 254 340 272 340 272 352 L 272 400" />
        <Stroke
          delay={1.6}
          d="M232 470 C 228 440 236 410 254 400 M272 400 C 292 404 306 418 304 440 C 302 456 298 466 296 474 M254 420 C 262 424 268 424 274 420"
        />

        {/* Sparkles */}
        <Stroke delay={1.8} width={1} className="text-azure" d="M440 300 L 440 324 M428 312 L 452 312" />
        <Stroke delay={1.9} width={1} className="text-azure" d="M78 230 L 78 248 M69 239 L 87 239" />
        <Stroke delay={2} width={1} d="M470 420 L 470 432 M464 426 L 476 426" />
      </svg>

      <Bubble className="top-[6%] left-[-2%] w-[56%]" delay={1.9} tail="down">
        It happens to the best of us.
      </Bubble>
      <Bubble className="top-[38%] right-[-6%] w-[40%]" delay={2.5} tail="left">
        Don&apos;t be shy.
      </Bubble>
      <Bubble className="bottom-[2%] right-[0%] w-[52%]" delay={3.1} tail="left">
        Your secret stays between us.
      </Bubble>
    </div>
  );
}
