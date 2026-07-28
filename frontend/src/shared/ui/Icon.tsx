import type { LucideIcon } from "lucide-react";
import { classNames } from "@/shared/lib/classNames";

interface IconProps {
  icon: LucideIcon;
  className?: string;
  spin?: boolean;
}

export function Icon({ icon: IconComponent, className, spin }: IconProps) {
  const classes = classNames(className, spin && "app-icon--spin");

  return <IconComponent className={classes || undefined} aria-hidden strokeWidth={2} />;
}
