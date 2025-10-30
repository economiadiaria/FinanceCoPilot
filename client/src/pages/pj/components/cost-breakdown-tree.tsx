import { useMemo, useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  PJCostBreakdownGroup,
  PJCostBreakdownNode,
  PJCostBreakdownResponse,
} from "@/services/pj";

interface CostBreakdownTreeProps {
  groups: PJCostBreakdownGroup[];
  totals: PJCostBreakdownResponse["totals"];
  formatCurrency: (value: number) => string;
  defaultExpandedPaths?: string[];
}

type CostBreakdownNode = PJCostBreakdownGroup | PJCostBreakdownNode;

type FlattenedRow = {
  node: CostBreakdownNode;
  depth: number;
  pathKey: string;
  canExpand: boolean;
  isExpanded: boolean;
};

const NODE_INDENT_REM = 1.25;

function getNodeKey(node: CostBreakdownNode): string {
  return node.path.join("/");
}

function getChildren(node: CostBreakdownNode): PJCostBreakdownNode[] {
  return node.children ?? [];
}

export function CostBreakdownTree({
  groups,
  totals,
  formatCurrency,
  defaultExpandedPaths,
}: CostBreakdownTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(defaultExpandedPaths ?? groups.map((group) => getNodeKey(group))),
  );

  useEffect(() => {
    if (!defaultExpandedPaths) {
      return;
    }
    setExpandedPaths(new Set(defaultExpandedPaths));
  }, [defaultExpandedPaths?.join("|")]);

  const rows = useMemo<FlattenedRow[]>(() => {
    const flattened: FlattenedRow[] = [];

    const visit = (node: CostBreakdownNode, depth: number) => {
      const pathKey = getNodeKey(node);
      const children = getChildren(node);
      const canExpand = children.length > 0;
      const isExpanded = expandedPaths.has(pathKey);

      flattened.push({ node, depth, pathKey, canExpand, isExpanded });

      if (canExpand && isExpanded) {
        children.forEach((child) => visit(child, depth + 1));
      }
    };

    groups.forEach((group) => visit(group, 0));
    return flattened;
  }, [expandedPaths, groups]);

  const toggleNode = (pathKey: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  return (
    <Table data-testid="cost-breakdown-tree">
      <TableHeader>
        <TableRow>
          <TableHead>Categoria</TableHead>
          <TableHead className="text-right">Entradas</TableHead>
          <TableHead className="text-right">Saídas</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ node, depth, pathKey, canExpand, isExpanded }) => {
          const indentation = `${depth * NODE_INDENT_REM}rem`;
          const labelClass = cn(
            "flex items-center gap-2",
            !node.acceptsPostings && "font-semibold text-muted-foreground",
          );

          return (
            <TableRow
              key={pathKey}
              data-node-path={pathKey}
              data-node-depth={depth}
              data-accepts-postings={node.acceptsPostings}
            >
              <TableCell>
                <div className="flex items-center gap-2" style={{ paddingLeft: indentation }}>
                  {canExpand ? (
                    <button
                      type="button"
                      onClick={() => toggleNode(pathKey)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Recolher" : "Expandir"} ${node.label}`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground">•</span>
                  )}
                  <span className={labelClass}>{node.label}</span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(node.inflows)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(node.outflows)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(node.net)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Total geral</TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {formatCurrency(totals.inflows)}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {formatCurrency(totals.outflows)}
          </TableCell>
          <TableCell className="text-right tabular-nums font-semibold">
            {formatCurrency(totals.net)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
