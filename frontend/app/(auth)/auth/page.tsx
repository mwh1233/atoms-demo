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
  const [account, setAccount] = useState(""); // 登录用：邮箱或手机号
  const [email, setEmail] = useState("");    // 注册用：邮箱
  const [phone, setPhone] = useState("");    // 注册用：手机号
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccessMessage("");

    if (mode === "register") {
      // 注册校验
      if (!email.includes("@")) {
        setError("请输入正确的邮箱地址");
        return;
      }
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        setError("请输入正确的11位手机号");
        return;
      }
      if (password.length < 6) {
        setError("密码至少6位");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
    } else {
      // 登录校验：账号可以是邮箱或手机号
      const isEmail = account.includes("@");
      const isPhone = /^1[3-9]\d{9}$/.test(account);
      if (!isEmail && !isPhone) {
        setError("请输入正确的邮箱或手机号");
        return;
      }
    }

    setIsSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    let result;

    if (mode === "login") {
      // 登录：自动识别邮箱或手机号
      const isEmail = account.includes("@");
      let loginEmail = account;
      if (!isEmail) {
        // 手机号登录：从本地映射找对应邮箱（Demo方案，同一浏览器注册可用）
        try {
          const phoneMap = JSON.parse(localStorage.getItem("atoms_phone_map") || "{}");
          loginEmail = phoneMap[account] || `${account}@atoms.demo`;
        } catch {
          loginEmail = `${account}@atoms.demo`;
        }
      }
      result = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    } else {
      // 注册：用邮箱注册，手机号存在用户元数据
      result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            phone: phone,
          }
        }
      });

      // 注册成功后保存手机号->邮箱映射，支持手机号登录（Demo方案）
      if (!result.error && result.data.user) {
        try {
          const phoneMap = JSON.parse(localStorage.getItem("atoms_phone_map") || "{}");
          phoneMap[phone] = email;
          localStorage.setItem("atoms_phone_map", JSON.stringify(phoneMap));
        } catch {}

        // 注册成功：显示提示，切换到登录页，清空所有输入框
        setIsSubmitting(false);
        setSuccessMessage("注册成功！请输入账号密码登录");
        setAccount("");
        setPassword("");
        setEmail("");
        setPhone("");
        setConfirmPassword("");
        setMode("login");
        return;
      }
    }

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
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/10 blur-3xl" />
      </div>

      <Card className="relative w-full max-w-md border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl shadow-black/5">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {mode === "login" ? "欢迎回来" : "创建账号"}
          </CardTitle>
          <CardDescription className="text-sm">
            {mode === "login" ? "登录进入你的AI项目工作台" : "注册开始使用AI生成全栈应用"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Tabs value={mode} onValueChange={(value) => {
            setMode(value as AuthMode);
            setError("");
            setSuccessMessage("");
          }}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>

            {successMessage ? (
              <p className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2.5 text-sm text-green-600 dark:text-green-400 mb-4">
                {successMessage}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400 mb-4">
                {error}
              </p>
            ) : null}

            <TabsContent value="login" className="mt-0">
              <LoginForm
                account={account}
                isSubmitting={isSubmitting}
                password={password}
                setAccount={setAccount}
                setPassword={setPassword}
                onSubmit={handleSubmit}
              />
            </TabsContent>
            <TabsContent value="register" className="mt-0">
              <RegisterForm
                email={email}
                phone={phone}
                password={password}
                confirmPassword={confirmPassword}
                isSubmitting={isSubmitting}
                setEmail={setEmail}
                setPhone={setPhone}
                setPassword={setPassword}
                setConfirmPassword={setConfirmPassword}
                onSubmit={handleSubmit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

type LoginFormProps = {
  account: string;
  isSubmitting: boolean;
  password: string;
  setAccount: (value: string) => void;
  setPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function LoginForm({
  account,
  isSubmitting,
  password,
  setAccount,
  setPassword,
  onSubmit
}: LoginFormProps) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="login-account">
          邮箱/手机号
        </label>
        <Input
          id="login-account"
          autoComplete="username"
          placeholder="请输入邮箱或手机号"
          type="text"
          value={account}
          onChange={(event) => setAccount(event.target.value.trim())}
          className="h-11"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="login-password">
          密码
        </label>
        <Input
          id="login-password"
          autoComplete="current-password"
          minLength={6}
          placeholder="至少 6 位密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11"
          required
        />
      </div>
      <Button className="w-full h-11 text-base font-medium mt-2" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "登录中..." : "登录"}
      </Button>
    </form>
  );
}

type RegisterFormProps = {
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  isSubmitting: boolean;
  setEmail: (value: string) => void;
  setPhone: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function RegisterForm({
  email,
  phone,
  password,
  confirmPassword,
  isSubmitting,
  setEmail,
  setPhone,
  setPassword,
  setConfirmPassword,
  onSubmit
}: RegisterFormProps) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="register-email">
          邮箱
        </label>
        <Input
          id="register-email"
          autoComplete="email"
          inputMode="email"
          placeholder="请输入邮箱地址"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value.trim())}
          className="h-11"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="register-phone">
          手机号
        </label>
        <Input
          id="register-phone"
          autoComplete="tel"
          inputMode="numeric"
          placeholder="请输入11位手机号"
          type="tel"
          maxLength={11}
          value={phone}
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
          className="h-11"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="register-password">
          密码
        </label>
        <Input
          id="register-password"
          autoComplete="new-password"
          minLength={6}
          placeholder="至少 6 位密码"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-11"
          required
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/90" htmlFor="register-confirm-password">
          确认密码
        </label>
        <Input
          id="register-confirm-password"
          autoComplete="new-password"
          minLength={6}
          placeholder="再次输入密码"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="h-11"
          required
        />
      </div>
      <Button className="w-full h-11 text-base font-medium mt-2" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "注册中..." : "注册"}
      </Button>
    </form>
  );
}
