"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "login" | "register";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const result =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setIsSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const pendingPrompt = new URLSearchParams(window.location.search).get("prompt");

    if (pendingPrompt && result.data.user) {
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({
          user_id: result.data.user.id,
          name: pendingPrompt.slice(0, 20),
          description: null,
          initial_prompt: pendingPrompt,
          status: "pending",
          current_step: null,
          generated_code: null,
          error_message: null,
          deploy_status: "not_deployed",
          deployed_url: null,
          deployed_at: null
        })
        .select("id")
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      router.push(`/project/${data.id}`);
      router.refresh();
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <section className="grid min-h-[calc(100vh-9rem)] items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
      <Card className="border-border/80 bg-card/90 shadow-xl shadow-black/20">
        <CardHeader>
          <CardTitle className="text-2xl">
            {mode === "login" ? "登录 Atoms" : "创建 Atoms 账号"}
          </CardTitle>
          <CardDescription>
            使用邮箱和密码进入你的项目工作台。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <AuthForm
                buttonText="登录"
                email={email}
                error={error}
                isSubmitting={isSubmitting}
                password={password}
                setEmail={setEmail}
                setPassword={setPassword}
                onSubmit={handleSubmit}
              />
            </TabsContent>
            <TabsContent value="register">
              <AuthForm
                buttonText="注册"
                email={email}
                error={error}
                isSubmitting={isSubmitting}
                password={password}
                setEmail={setEmail}
                setPassword={setPassword}
                onSubmit={handleSubmit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="space-y-6 rounded-lg border border-border/70 bg-secondary/20 p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-6 w-6" />
        </div>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Atoms</p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-normal">
            从一句需求开始，生成、预览并部署你的前端项目。
          </h1>
          <p className="max-w-lg text-muted-foreground">
            登录后进入工作台，继续管理项目、查看生成进度和访问预览页面。
          </p>
        </div>
      </div>
    </section>
  );
}

type AuthFormProps = {
  buttonText: string;
  email: string;
  error: string;
  isSubmitting: boolean;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function AuthForm({
  buttonText,
  email,
  error,
  isSubmitting,
  password,
  setEmail,
  setPassword,
  onSubmit
}: AuthFormProps) {
  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${buttonText}-email`}>
          邮箱
        </label>
        <Input
          id={`${buttonText}-email`}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${buttonText}-password`}>
          密码
        </label>
        <Input
          id={`${buttonText}-password`}
          autoComplete={buttonText === "登录" ? "current-password" : "new-password"}
          minLength={6}
          placeholder="至少 6 位密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      {error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "处理中..." : buttonText}
      </Button>
    </form>
  );
}
