import { useMemo } from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePJFilters } from "@/contexts/PJFiltersContext";
import { formatRangeLabel } from "@/lib/date-range";
import { cn } from "@/lib/utils";

export function PJDateRangePicker() {
  const { dateRange, setDateRange } = usePJFilters();

  const label = useMemo(() => formatRangeLabel(dateRange), [dateRange]);

  const handleSelect = (range: DateRange | undefined) => {
    setDateRange(range ?? {});
  };

  return (
    <div className="flex flex-col gap-1" data-testid="pj-date-range-filter">
      <span className="text-[0.65rem] uppercase text-muted-foreground">Período</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-[260px] justify-start text-left font-normal", 
              !dateRange.from && !dateRange.to && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            <span>{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            numberOfMonths={2}
            selected={{ from: dateRange.from, to: dateRange.to }}
            defaultMonth={dateRange.from ?? dateRange.to ?? new Date()}
            onSelect={handleSelect}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
