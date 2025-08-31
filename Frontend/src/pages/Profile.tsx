// src/pages/Profile.tsx
import { useEffect, useState } from "react";

export default function Profile() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(sessionStorage.getItem("fitbit_user_id"));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl w-full text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to HealthSync</h1>
        {userId ? (
          <p className="text-muted-foreground">
            Connected with Fitbit. <strong>User ID:</strong> {userId}
          </p>
        ) : (
          <p className="text-muted-foreground">
            You’re signed in with Fitbit. We’ll fetch your profile and metrics
            here next.
          </p>
        )}
      </div>
    </main>
  );
}
