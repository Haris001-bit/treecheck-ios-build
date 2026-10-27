import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import treecheckLogo from "@/assets/treecheck-white-login.png";
import { GetTheApp } from "@/components/GetTheApp";

export default function Install() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src={treecheckLogo} alt="TREECHECK Logo" className="h-16 w-auto object-contain" />
          </div>
          <CardTitle className="text-2xl">Get the TREECHECK App</CardTitle>
          <CardDescription>
            Download it on your phone to start receiving leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <GetTheApp />

          <div className="pt-4 border-t text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              ← Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
