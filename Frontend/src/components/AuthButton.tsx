type Props = {
  onClick: () => void;
  disabled?: boolean;
  label: string; // 👈 make label required so we can specify "Login with Fitbit" or "Login with Withings"
};

export default function AuthButton({ onClick, disabled, label }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full max-w-md mx-auto block rounded-xl px-6 py-3 font-medium border border-white/20 hover:border-white/40"
    >
      {label}
    </button>
  );
}
