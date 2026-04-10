import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import { LocaleProvider } from "@/locale/LocaleContext";
import { ThemeProvider } from "@/theme/ThemeContext";
import { Layout } from "@/components/Layout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ChatPage } from "@/pages/ChatPage";
import { LoginPage } from "@/pages/LoginPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TaskDetailPage } from "@/pages/TaskDetailPage";
import { TasksPage } from "@/pages/TasksPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { WorkspacePage } from "@/pages/WorkspacePage";

export function App() {
    return (
        <BrowserRouter>
            <ThemeProvider>
            <AuthProvider>
                <LocaleProvider>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<Layout />}>
                            <Route index element={<ChatPage />} />
                            <Route path="tasks" element={<TasksPage />} />
                            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
                            <Route path="templates" element={<TemplatesPage />} />
                            <Route path="workspace" element={<WorkspacePage />} />
                            <Route path="settings" element={<SettingsPage />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Route>
                    </Route>
                </Routes>
                </LocaleProvider>
            </AuthProvider>
            </ThemeProvider>
        </BrowserRouter>
    );
}
