import {
  Award,
  Crown,
  Shield,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { RankTier } from "@/lib/goals-config";

export const RANK_ICON_MAP: Record<string, LucideIcon> = {
  Target,
  Star,
  TrendingUp,
  Zap,
  Crown,
  Trophy,
  Award,
  Shield,
  Sparkles,
};

export function rankIconFor(rank: RankTier | null | undefined): LucideIcon {
  if (!rank) return Shield;
  return RANK_ICON_MAP[rank.icon] ?? Shield;
}
