import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen space-y-4">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <h2 className="text-2xl font-semibold">Página não encontrada</h2>
      <p className="text-muted-foreground">A página que você está procurando não existe.</p>
      <Link href="/">
        <Button data-testid="button-home">
          <Home className="mr-2 h-4 w-4" />
          Voltar ao Dashboard
        </Button>
      </Link>
    </div>
  );
}
