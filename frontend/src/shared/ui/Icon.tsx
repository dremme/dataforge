import type { LucideIcon } from "lucide-react";

interface IconProps {
  icon: LucideIcon;
  className?: string;
  spin?: boolean;
}

export function Icon({ icon: IconComponent, className, spin }: IconProps) {
  const classes = [className, spin ? "app-icon--spin" : undefined].filter(Boolean).join(" ");

  return <IconComponent className={classes || undefined} aria-hidden strokeWidth={2} />;
}
