"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface TextProps {
  children: React.ReactNode;
  reverse?: boolean;
  transition?: Record<string, unknown>;
  splitBy?: "words" | "characters" | "lines" | string;
  staggerDuration?: number;
  staggerFrom?: "first" | "last" | "center" | "random" | number;
  containerClassName?: string;
  wordLevelClassName?: string;
  elementLevelClassName?: string;
  onClick?: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  autoStart?: boolean;
}

export interface VerticalCutRevealRef {
  startAnimation: () => void;
  reset: () => void;
}

interface WordObject {
  characters: string[];
  needsSpace: boolean;
}

/**
 * VerticalCutReveal (danielpetho) — adapted for this project:
 * - imports from "motion/react" instead of "framer-motion";
 * - honours prefers-reduced-motion (renders the text instantly);
 * - fixes the reference copy's broken "lines" split (the "\n" literal).
 */
const VerticalCutReveal = forwardRef<VerticalCutRevealRef, TextProps>(
  (
    {
      children,
      reverse = false,
      transition = {
        type: "spring",
        stiffness: 190,
        damping: 22,
      },
      splitBy = "words",
      staggerDuration = 0.2,
      staggerFrom = "first",
      containerClassName,
      wordLevelClassName,
      elementLevelClassName,
      onClick,
      onStart,
      onComplete,
      autoStart = true,
      ...props
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLSpanElement>(null);
    const text =
      typeof children === "string" ? children : children?.toString() || "";
    const [isAnimating, setIsAnimating] = useState(false);
    const reducedMotion = useReducedMotion();

    const splitIntoCharacters = (input: string): string[] => {
      if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
        const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
        return Array.from(segmenter.segment(input), ({ segment }) => segment);
      }
      return Array.from(input);
    };

    const elements = useMemo(() => {
      const words = text.split(" ");
      if (splitBy === "characters") {
        return words.map((word, i) => ({
          characters: splitIntoCharacters(word),
          needsSpace: i !== words.length - 1,
        }));
      }
      return splitBy === "words"
        ? text.split(" ")
        : splitBy === "lines"
          ? text.split("\n")
          : text.split(splitBy);
    }, [text, splitBy]);

    const getStaggerDelay = useCallback(
      (index: number) => {
        const total =
          splitBy === "characters"
            ? elements.reduce(
                (acc, word) =>
                  acc +
                  (typeof word === "string"
                    ? 1
                    : word.characters.length + (word.needsSpace ? 1 : 0)),
                0,
              )
            : elements.length;
        if (staggerFrom === "first") return index * staggerDuration;
        if (staggerFrom === "last") return (total - 1 - index) * staggerDuration;
        if (staggerFrom === "center") {
          const center = Math.floor(total / 2);
          return Math.abs(center - index) * staggerDuration;
        }
        if (staggerFrom === "random") {
          const randomIndex = Math.floor(Math.random() * total);
          return Math.abs(randomIndex - index) * staggerDuration;
        }
        return Math.abs(Number(staggerFrom) - index) * staggerDuration;
      },
      [elements, splitBy, staggerFrom, staggerDuration],
    );

    const startAnimation = useCallback(() => {
      setIsAnimating(true);
      onStart?.();
    }, [onStart]);

    useImperativeHandle(ref, () => ({
      startAnimation,
      reset: () => setIsAnimating(false),
    }));

    useEffect(() => {
      if (autoStart) {
        // With reduced motion we skip the animation entirely: the plain text
        // below (sr-only) stays hidden, so render the visible spans settled.
        if (!reducedMotion) startAnimation();
        else setIsAnimating(true);
      }
    }, [autoStart, reducedMotion, startAnimation]);

    const variants = {
      hidden: { y: reverse ? "-100%" : "100%" },
      visible: (i: number) => ({
        y: 0,
        transition: {
          ...(transition as { delay?: number }),
          delay:
            ((transition as { delay?: number })?.delay || 0) +
            getStaggerDelay(i),
        },
      }),
    };

    return (
      <span
        className={cn(
          containerClassName,
          "flex flex-wrap whitespace-pre-wrap",
          splitBy === "lines" && "flex-col",
        )}
        onClick={onClick}
        ref={containerRef}
        {...props}
      >
        <span className="sr-only">{text}</span>

        {(splitBy === "characters"
          ? (elements as WordObject[])
          : (elements as string[]).map((el, i) => ({
              characters: [el],
              needsSpace: i !== elements.length - 1,
            }))
        ).map((wordObj, wordIndex, array) => {
          const previousCharsCount = array
            .slice(0, wordIndex)
            .reduce((sum, word) => sum + word.characters.length, 0);

          return (
            <span
              key={wordIndex}
              aria-hidden="true"
              className={cn("inline-flex overflow-hidden", wordLevelClassName)}
            >
              {wordObj.characters.map((char, charIndex) => (
                <span
                  className={cn(
                    elementLevelClassName,
                    "relative whitespace-pre-wrap",
                  )}
                  key={charIndex}
                >
                  <motion.span
                    custom={previousCharsCount + charIndex}
                    initial="hidden"
                    animate={isAnimating ? "visible" : "hidden"}
                    variants={variants}
                    onAnimationComplete={
                      wordIndex === elements.length - 1 &&
                      charIndex === wordObj.characters.length - 1
                        ? onComplete
                        : undefined
                    }
                    className="inline-block"
                  >
                    {char}
                  </motion.span>
                </span>
              ))}
              {wordObj.needsSpace && <span> </span>}
            </span>
          );
        })}
      </span>
    );
  },
);

VerticalCutReveal.displayName = "VerticalCutReveal";

export { VerticalCutReveal };
