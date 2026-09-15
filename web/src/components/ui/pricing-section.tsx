"use client";

import { motion, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { CheckCheck, Zap } from "lucide-react";
import { useId, useState } from "react";
import { VerticalCutReveal } from "@/components/ui/vertical-cut-reveal";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* CMS-shaped props — the page (Server Component) fills these from     */
/* site_settings with safe fallbacks.                                  */
/* ------------------------------------------------------------------ */

export interface PricingContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  featuresTitle: string;
  features: string[];
  updatesTitle: string;
  updatesHint: string;
  updatesLabel1: string;
  updatesLabel2: string;
  licenseTitle: string;
  licenseHint: string;
  licenseLabel1: string;
  licenseLabel2: string;
  ctaLabel: string;
  /** Toman prices per switch state: [personal, corporate][3m, forever]. */
  plans: {
    personal3m: number;
    personalForever: number;
    corporate3m: number;
    corporateForever: number;
  };
}

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(8px)" },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { delay: i * 0.08, duration: 0.5, ease: "easeOut" as const },
  }),
};

/** Persian-formatted Toman, e.g. ۹۸٬۰۰۰ */
const toman = (value: number) =>
  new Intl.NumberFormat("fa-IR").format(value * 1000);
void toman; // reserved for non-NumberFlow fallback rendering

/* ------------------------------------------------------------------ */

const PricingSwitch = ({
  button1,
  button2,
  onSwitch,
  className,
  layoutId,
}: {
  button1: string;
  button2: string;
  onSwitch: (value: string) => void;
  className?: string;
  layoutId?: string;
}) => {
  const [selected, setSelected] = useState("0");
  const uniqueId = useId();
  const switchLayoutId = layoutId || `switch-${uniqueId}`;

  const handleSwitch = (value: string) => {
    setSelected(value);
    onSwitch(value);
  };

  return (
    <div
      role="group"
      aria-label={`${button1} / ${button2}`}
      className={cn(
        "relative z-10 flex w-full rounded-full border border-gray-200 bg-neutral-50 p-1",
        className,
      )}
    >
      {(
        [
          { value: "0", label: button1 },
          { value: "1", label: button2 },
        ] as const
      ).map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={selected === value}
          onClick={() => handleSwitch(value)}
          className={cn(
            "relative z-10 w-full h-10 rounded-full px-3 py-1 font-medium transition-colors sm:h-14 sm:px-6 sm:py-2",
            selected === value
              ? "text-white"
              : "text-muted-foreground hover:text-gray-900",
          )}
        >
          {selected === value && (
            <motion.span
              layoutId={switchLayoutId}
              className="absolute left-0 top-0 h-10 w-full rounded-full border-4 border-gray-900 bg-gradient-to-t from-neutral-900 via-neutral-800 to-neutral-900 shadow-sm shadow-black sm:h-14"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
};

export default function PricingSection({ content }: { content: PricingContent }) {
  const [isUpdates, setIsUpdates] = useState(false);
  const [isCorporate, setIsCorporate] = useState(false);
  const reducedMotion = useReducedMotion();

  const toggleUpdates = (value: string) =>
    setIsUpdates(Number.parseInt(value) === 1);
  const toggleCorporate = (value: string) =>
    setIsCorporate(Number.parseInt(value) === 1);

  const calculatePrice = () => {
    if (!isUpdates && !isCorporate) return content.plans.personal3m;
    if (isUpdates && !isCorporate) return content.plans.personalForever;
    if (!isUpdates && isCorporate) return content.plans.corporate3m;
    return content.plans.corporateForever;
  };

  const currentPrice = calculatePrice();
  // Crossed-out anchor price (قیمت قبل از تخفیف) — same 1.45 markup as the
  // reference design. Plans are stored in THOUSANDS of Toman, so convert to
  // raw Toman before applying the markup and rounding to the nearest thousand.
  const originalPrice = Math.round((currentPrice * 1000 * 1.45) / 1000) * 1000;

  const MotionDiv = reducedMotion ? "div" : motion.div;

  return (
    <div className="relative mx-auto w-full min-h-screen px-4 pt-10">
      <div className="bg-white px-4 py-16">
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(125% 125% at 50% 90%, #fff 40%, var(--color-primary) 100%)",
          }}
        />
        <div className="relative z-10 mx-auto max-w-4xl text-center">
          <MotionDiv
            variants={fadeUp}
            custom={0}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.4 }}
            className="mb-4 flex items-center justify-center"
          >
            <Zap className="me-2 h-5 w-5 fill-emerald-500 text-emerald-500" />
            <span className="font-medium text-emerald-600">{content.eyebrow}</span>
          </MotionDiv>

          <h1 className="mb-4 text-3xl font-semibold leading-[120%] text-gray-900 sm:text-4xl md:text-5xl">
            <VerticalCutReveal
              splitBy="words"
              staggerDuration={0.15}
              staggerFrom="first"
              containerClassName="justify-center"
              transition={{
                type: "spring",
                stiffness: 250,
                damping: 40,
                delay: 0.4,
              }}
            >
              {content.title}
            </VerticalCutReveal>
          </h1>

          <MotionDiv
            variants={fadeUp}
            custom={1}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.4 }}
            className="text-xl text-gray-600"
          >
            {content.subtitle}
          </MotionDiv>
        </div>
      </div>

      {/* Features + switches + price */}
      <div className="relative z-10 px-4 pb-16">
        <div className="mx-auto max-w-6xl">
          <div className="grid items-center gap-8 sm:grid-cols-2 md:gap-12">
            <div>
              <MotionDiv
                variants={fadeUp}
                custom={2}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
                className="mb-2 text-3xl font-medium text-gray-900"
              >
                <h3>{content.featuresTitle}</h3>
              </MotionDiv>

              <div className="space-y-4">
                {content.features.map((feature, index) => (
                  <MotionDiv
                    key={index}
                    variants={fadeUp}
                    custom={3 + index}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, amount: 0.3 }}
                    className="flex items-center"
                  >
                    <div className="me-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shadow-md shadow-emerald-500">
                      <CheckCheck className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-gray-700">{feature}</span>
                  </MotionDiv>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              <MotionDiv
                variants={fadeUp}
                custom={3}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
              >
                <h4 className="mb-2 font-semibold text-gray-900">
                  {content.updatesTitle}
                </h4>
                <p className="mb-2 text-sm text-gray-600">{content.updatesHint}</p>
                <PricingSwitch
                  button1={content.updatesLabel1}
                  button2={content.updatesLabel2}
                  onSwitch={toggleUpdates}
                  className="grid w-full grid-cols-2"
                />
              </MotionDiv>

              <MotionDiv
                variants={fadeUp}
                custom={4}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
              >
                <h4 className="mb-1 font-semibold text-gray-900">
                  {content.licenseTitle}
                </h4>
                <p className="mb-2 text-sm text-gray-600">{content.licenseHint}</p>
                <PricingSwitch
                  button1={content.licenseLabel1}
                  button2={content.licenseLabel2}
                  onSwitch={toggleCorporate}
                  className="grid w-full grid-cols-2"
                />
              </MotionDiv>

              <MotionDiv
                variants={fadeUp}
                custom={5}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
                className="grid grid-cols-2 items-center gap-2 px-2 text-center"
              >
                <div className="mb-4 flex items-center justify-center gap-2" dir="ltr">
                  <span className="text-2xl font-semibold text-gray-900 sm:text-5xl">
                    <NumberFlow
                      value={currentPrice * 1000}
                      format={{
                        numberingSystem: "arabext",
                      }}
                      suffix=" تومان"
                      className="text-2xl font-semibold sm:text-5xl"
                    />
                  </span>
                  <span
                    className="relative text-lg text-gray-600 before:absolute before:left-0 before:top-3 before:z-10 before:h-0.5 before:w-full before:bg-gray-800 sm:text-xl"
                    dir="rtl"
                  >
                    <NumberFlow
                      value={originalPrice}
                      format={{ numberingSystem: "arabext" }}
                      suffix=" تومان"
                      className="text-lg font-semibold line-through sm:text-xl"
                    />
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-lg w-full border-4 border-emerald-600 text-lg sm:h-16 sm:text-xl"
                >
                  {content.ctaLabel}
                </button>
              </MotionDiv>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
