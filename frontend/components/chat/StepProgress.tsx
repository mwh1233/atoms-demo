"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["分析需求", "设计方案", "生成代码", "部署上线"];

type StepProgressProps = {
  currentStep: number;
};

export function StepProgress({ currentStep }: StepProgressProps) {
  return (
    <div className="border-b border-border bg-background/70 px-4 py-3">
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;

          return (
            <div key={step} className="flex flex-1 items-center last:flex-none">
              <div className="flex min-w-0 flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-all duration-300",
                    isCompleted &&
                      "border-emerald-400 bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/20",
                    isActive &&
                      "animate-pulse border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/20",
                    !isCompleted && !isActive && "border-border bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "hidden text-center text-xs text-muted-foreground transition-colors sm:block",
                    (isCompleted || isActive) && "text-foreground"
                  )}
                >
                  {step}
                </span>
              </div>
              {index < steps.length - 1 ? (
                <div
                  className={cn(
                    "mx-2 h-px flex-1 bg-border transition-colors duration-500",
                    index < currentStep && "bg-emerald-500",
                    index === currentStep && "bg-sky-500/70"
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
