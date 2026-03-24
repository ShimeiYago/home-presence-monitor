import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type OverviewCardProps = {
  title: string;
  titleIcon?: ReactNode;
  description?: string;
  status: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  href: string;
};

export function OverviewCard({
  title,
  titleIcon,
  description,
  status,
  primary,
  secondary,
  href,
}: OverviewCardProps) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900">
            {titleIcon}
            <span>{title}</span>
          </CardTitle>
          {status}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-3xl font-semibold tracking-tight text-slate-900">
          {primary}
        </p>
        {secondary && <p className="text-sm text-slate-600">{secondary}</p>}
      </CardContent>
      <CardFooter className="justify-end">
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
        >
          もっと見る
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardFooter>
    </Card>
  );
}
