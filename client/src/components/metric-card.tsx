import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: React.ReactNode;
  prefix?: string;
  testId?: string;
}

export function MetricCard({ title, value, change, icon, prefix = "R$", testId }: MetricCardProps) {
  const hasChange = change !== undefined && change !== 0;
  const isPositive = change && change > 0;
  const displayValue = prefix ? `${prefix} ${value}` : value;

  return (
    <Card className="min-h-32" data-testid={testId}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums" data-testid={`${testId}-value`}>
          {displayValue}
        </div>
        {hasChange && (
          <div className={cn(
            "flex items-center text-sm font-medium mt-2",
            isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
          )}>
            {isPositive ? (
              <ArrowUp className="mr-1 h-4 w-4" />
            ) : (
              <ArrowDown className="mr-1 h-4 w-4" />
            )}
            <span>{Math.abs(change).toFixed(1)}pp vs mês anterior</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
