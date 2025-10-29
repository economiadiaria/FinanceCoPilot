import type { ComponentType, SVGProps } from "react";
import {
  Home,
  FileText,
  TrendingUp,
  FileBarChart,
  Settings,
  Building2,
  BarChart3,
  CreditCard,
  Users,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";

export type MenuItem = {
  title: string;
  url: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  testId?: string;
};

export const menuItems: MenuItem[] = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Transações",
    url: "/transacoes",
    icon: FileText,
  },
  {
    title: "Investimentos",
    url: "/investimentos",
    icon: TrendingUp,
  },
  {
    title: "Relatórios",
    url: "/relatorios",
    icon: FileBarChart,
  },
  {
    title: "Open Finance",
    url: "/open-finance",
    icon: Building2,
  },
  {
    title: "Configurações",
    url: "/configuracoes",
    icon: Settings,
  },
];

export const pjMenuItems: MenuItem[] = [
  {
    title: "Dashboard PJ",
    url: "/pj/dashboard",
    icon: Home,
    testId: "link-pj-dashboard",
  },
  {
    title: "Resumo",
    url: "/pj/resumo",
    icon: BarChart3,
    testId: "link-pj-resumo",
  },
  {
    title: "Transações",
    url: "/pj/transacoes",
    icon: CreditCard,
    testId: "link-pj-transacoes",
  },
  {
    title: "Relatórios PJ",
    url: "/pj/relatorios",
    icon: FileBarChart,
    testId: "link-pj-relatorios",
  },
];

const adminMenuItems: MenuItem[] = [
  {
    title: "Associações",
    url: "/admin/associacoes",
    icon: Users,
  },
  {
    title: "Auditoria",
    url: "/admin/auditoria",
    icon: ShieldCheck,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  return (
    <Sidebar data-testid="sidebar-main">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide">
            Pessoa Física
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={item.testId ?? `link-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wide">
            Pessoa Jurídica
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pjMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={item.testId ?? `link-pj-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === "master" && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs uppercase tracking-wide">
              Administração
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminMenuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      data-testid={item.testId ?? `link-admin-${item.title.toLowerCase()}`}
                    >
                      <Link href={item.url}>
                        <item.icon className="h-5 w-5" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
