"use client";

import { Environment, Float, Lightformer, MeshTransmissionMaterial } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, type Group } from "three";

// Two interlocking glass rings, the LinkRoom mark rendered as liquid glass.
function Rings({ still, dark }: { still: boolean; dark: boolean }) {
  const group = useRef<Group>(null);
  // The canvas is transparent, so give the glass the page colour to refract instead of black.
  const backdrop = useMemo(() => new Color(dark ? "#070a16" : "#eef1fb"), [dark]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (!still) g.rotation.y += delta * 0.18;
    // Ease toward the pointer so the object leans with the visitor.
    g.rotation.x += (state.pointer.y * 0.35 - g.rotation.x) * 0.04;
    g.rotation.z += (-state.pointer.x * 0.25 - g.rotation.z) * 0.04;
  });

  const glass = (
    <MeshTransmissionMaterial
      background={backdrop}
      backside
      samples={6}
      resolution={512}
      thickness={0.55}
      roughness={0.06}
      transmission={1}
      ior={1.35}
      chromaticAberration={0.22}
      anisotropy={0.25}
      distortion={0.25}
      distortionScale={0.4}
      temporalDistortion={0.08}
      color="#dfe7ff"
      attenuationColor="#5d82ff"
      attenuationDistance={1.6}
    />
  );

  return (
    <Float speed={still ? 0 : 1.2} rotationIntensity={0.25} floatIntensity={0.6}>
      <group ref={group} position={[0.2, 0.55, 0]} rotation={[0.35, -0.4, 0]} scale={0.82}>
        <mesh position={[-0.62, 0, 0]} rotation={[0, 0.35, 0]}>
          <torusGeometry args={[1, 0.28, 64, 160]} />
          {glass}
        </mesh>
        <mesh position={[0.62, 0, 0]} rotation={[Math.PI / 2, 0.35, 0]}>
          <torusGeometry args={[1, 0.28, 64, 160]} />
          {glass}
        </mesh>
      </group>
      {/* A coloured core behind the glass gives the refraction something blue to bend. */}
      <mesh position={[0.2, 0.55, -1.8]}>
        <sphereGeometry args={[0.75, 48, 48]} />
        <meshBasicMaterial color="#2f5bff" />
      </mesh>
    </Float>
  );
}

type Props = { still?: boolean; active?: boolean; dark?: boolean };

// `active` pauses the render loop while the hero is off screen, so the GPU is free for scroll effects.
export default function HeroScene({ still = false, active = true, dark = false }: Props) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 5.4], fov: 38 }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      frameloop={!active ? "never" : still ? "demand" : "always"}
    >
      <ambientLight intensity={0.4} />
      <Rings still={still} dark={dark} />
      {/* Studio lighting built from light cards, so nothing is fetched from a CDN. */}
      <Environment resolution={256}>
        <group rotation={[-Math.PI / 3, 0, 0]}>
          <Lightformer form="circle" intensity={4} position={[0, 5, -9]} scale={10} />
          <Lightformer form="rect" intensity={2} color="#9fb4ff" position={[-5, 1, -1]} rotation={[0, Math.PI / 2, 0]} scale={[20, 2, 1]} />
          <Lightformer form="rect" intensity={2.5} position={[5, -1, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[20, 1.5, 1]} />
          <Lightformer form="ring" intensity={3} color="#2f5bff" position={[2, 2, 4]} scale={3} />
        </group>
      </Environment>
    </Canvas>
  );
}
