import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Index from "@/pages/Index";
import Callback from "@/pages/Callback";
import Dashboard from "@/pages/Dashboard";
import AuthCallback from "./pages/AuthCallback";
import StepsPage from "./pages/metrics/Steps";
import Weights from "./pages/metrics/Weights";
import Distance from "./pages/metrics/Distance";
import Spo2 from "./pages/metrics/Spo2";
import Temperature from "./pages/metrics/Temperature";
import SkinTemperaturePage from "./pages/metrics/SkinTemperature";
import AverageHeartRate from "./pages/metrics/AverageHeartRate";
import HRVPage from "./pages/metrics/HRV";
import SleepPage from "./pages/metrics/Sleep";
import CaloriesPage from "./pages/metrics/Calories";
import ECGPage from "./pages/metrics/ECG";
import BreathingRatePage from "./pages/metrics/BreathingRate";
import RestingHeartRatePage from "./pages/metrics/RestingHeartRate";

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/dashboard"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="/metrics/steps"
            element={
              <Protected>
                <StepsPage />
              </Protected>
            }
          />
          <Route
            path="/metrics/weight"
            element={
              <Protected>
                <Weights />
              </Protected>
            }
          />
          <Route
            path="/metrics/distance"
            element={
              <Protected>
                <Distance />
              </Protected>
            }
          />
          <Route
            path="/metrics/spo2"
            element={
              <Protected>
                <Spo2 />
              </Protected>
            }
          />
          <Route
            path="/metrics/temperature"
            element={
              <Protected>
                <Temperature />
              </Protected>
            }
          />
          <Route
            path="/metrics/skin-temperature"
            element={
              <Protected>
                <SkinTemperaturePage />
              </Protected>
            }
          />
          <Route
            path="/metrics/heart-rate"
            element={
              <Protected>
                <AverageHeartRate />
              </Protected>
            }
          />
          <Route
            path="/metrics/hrv"
            element={
              <Protected>
                <HRVPage />
              </Protected>
            }
          />
          <Route
            path="/metrics/sleep"
            element={
              <Protected>
                <SleepPage />
              </Protected>
            }
          />
          <Route
            path="/metrics/calories"
            element={
              <Protected>
                <CaloriesPage />
              </Protected>
            }
          />
          <Route
            path="/metrics/breathing-rate"
            element={
              <Protected>
                <BreathingRatePage />
              </Protected>
            }
          />
          <Route
            path="/metrics/resting-heart-rate"
            element={
              <Protected>
                <RestingHeartRatePage />
              </Protected>
            }
          />
          <Route
            path="/metrics/ecg"
            element={
              <Protected>
                <ECGPage />
              </Protected>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
