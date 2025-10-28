import { Home, FileText, TrendingUp, FileBarChart, Settings, Building2, BarChart3, CreditCard, Brain, Users, ShieldCheck } from "lucide-react";
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

const menuItems = [
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

const pjMenuItems = [
  {
    title: "Dashboard PJ",
    url: "/pj/dashboard",
    icon: Home,
  },
  {
    title: "Vendas",
    url: "/pj/vendas",
    icon: BarChart3,
  },
  {
    title: "Conciliação",
    url: "/pj/conciliacao",
    icon: CreditCard,
  },
  {
    title: "Relatórios PJ",
    url: "/pj/relatorios",
    icon: FileBarChart,
  },
  {
    title: "Regras",
    url: "/pj/regras",
    icon: Brain,
  },
];

const adminMenuItems = [
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
                    data-testid={`link-${item.title.toLowerCase()}`}
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
                    data-testid={`link-pj-${item.title.toLowerCase()}`}
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
                      data-testid={`link-admin-${item.title.toLowerCase()}`}
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
