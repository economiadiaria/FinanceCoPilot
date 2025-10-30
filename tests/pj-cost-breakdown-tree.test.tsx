import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CostBreakdownTree } from "../client/src/pages/pj/components/cost-breakdown-tree";
import {
  normalizeCostBreakdownResponse,
  type PJCostBreakdownResponse,
} from "../client/src/services/pj";

describe("CostBreakdownTree", () => {
  it("renders nested cost categories with totals", () => {
    const sampleResponse: PJCostBreakdownResponse = {
      month: null,
      availableMonths: [],
      totals: {
        inflows: 10000,
        outflows: 4000,
        net: 6000,
      },
      groups: [
        {
          key: "CUSTOS",
          label: "Custos",
          inflows: 10000,
          outflows: 4000,
          net: 6000,
          group: "CUSTOS",
          acceptsPostings: false,
          level: 0,
          path: [],
          items: [
            {
              key: "custos.operacionais",
              label: "Operacionais",
              inflows: 10000,
              outflows: 4000,
              net: 6000,
              categoryId: "custos.operacionais",
              categoryPath: "custos.operacionais",
              level: 1,
              path: [],
              group: "CUSTOS",
              acceptsPostings: false,
              sortOrder: 10,
              directInflows: 0,
              directOutflows: 0,
              children: [
                {
                  key: "custos.operacionais.equipe",
                  label: "Equipe",
                  inflows: 5000,
                  outflows: 2000,
                  net: 3000,
                  categoryId: "custos.operacionais.equipe",
                  categoryPath: "custos.operacionais.equipe",
                  level: 2,
                  path: [],
                  group: "CUSTOS",
                  acceptsPostings: false,
                  sortOrder: 10,
                  directInflows: 0,
                  directOutflows: 0,
                  children: [
                    {
                      key: "custos.operacionais.equipe.salarios",
                      label: "Salários",
                      inflows: 0,
                      outflows: 1500,
                      net: -1500,
                      categoryId: "custos.operacionais.equipe.salarios",
                      categoryPath: "custos.operacionais.equipe.salarios",
                      level: 3,
                      path: [],
                      group: "CUSTOS",
                      acceptsPostings: true,
                      sortOrder: 10,
                      directInflows: 0,
                      directOutflows: 1500,
                      children: [],
                    },
                    {
                      key: "custos.operacionais.equipe.beneficios",
                      label: "Benefícios",
                      inflows: 0,
                      outflows: 500,
                      net: -500,
                      categoryId: "custos.operacionais.equipe.beneficios",
                      categoryPath: "custos.operacionais.equipe.beneficios",
                      level: 3,
                      path: [],
                      group: "CUSTOS",
                      acceptsPostings: true,
                      sortOrder: 20,
                      directInflows: 0,
                      directOutflows: 500,
                      children: [],
                    },
                  ],
                },
                {
                  key: "custos.operacionais.infra",
                  label: "Infraestrutura",
                  inflows: 5000,
                  outflows: 2000,
                  net: 3000,
                  categoryId: "custos.operacionais.infra",
                  categoryPath: "custos.operacionais.infra",
                  level: 2,
                  path: [],
                  group: "CUSTOS",
                  acceptsPostings: true,
                  sortOrder: 20,
                  directInflows: 0,
                  directOutflows: 2000,
                  children: [],
                },
              ],
            },
          ],
          children: [],
        },
      ],
      tree: [],
      uncategorized: {
        total: 0,
        count: 0,
        items: [],
      },
      requestId: null,
    };

    const normalized = normalizeCostBreakdownResponse(sampleResponse);
    const groups = normalized.tree;
    const defaultExpanded = groups.flatMap((group) => {
      const paths = [group.path.join("/")];
      group.children
        .filter((child) => !child.acceptsPostings && child.children.length > 0)
        .forEach((child) => paths.push(child.path.join("/")));
      return paths;
    });

    const markup = renderToStaticMarkup(
      <CostBreakdownTree
        groups={groups}
        totals={normalized.totals}
        formatCurrency={(value) => `R$ ${value.toFixed(2)}`}
        defaultExpandedPaths={defaultExpanded}
      />,
    );

    const rowCount = (markup.match(/data-node-path=/g) ?? []).length;
    assert.equal(rowCount, 5, "should render group and four nested rows");

    const rootPath = groups[0].path.join("/");
    assert(markup.includes(`data-node-path="${rootPath}"`), "renders root group");

    const secondLevel = groups[0].children[0].path.join("/");
    const thirdLevel = groups[0].children[0].children[0].path.join("/");
    const leafPath = groups[0].children[0].children[1].path.join("/");
    assert(markup.includes(`data-node-path="${secondLevel}"`), "renders level 2 aggregator");
    assert(markup.includes(`data-node-path="${thirdLevel}"`), "renders level 3 leaf");
    assert(markup.includes(`data-node-path="${leafPath}"`), "renders sibling leaf");

    assert(markup.includes("R$ 10000.00"), "displays inflow total");
    assert(markup.includes("R$ -1500.00"), "displays negative value for salários");
    assert(markup.includes("Total geral"), "renders totals footer");
  });
});
