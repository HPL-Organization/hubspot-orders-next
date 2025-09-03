import { styled, keyframes } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import HourglassBottomRoundedIcon from "@mui/icons-material/HourglassBottomRounded";

const shimmer = keyframes`
  0%   { background-position: 0% 50% }
  100% { background-position: 200% 50% }
`;
const pop = keyframes`
  0% { transform: scale(.95); opacity:.85 }
  60% { transform: scale(1.02); opacity:1 }
  100% { transform: scale(1) }
`;
const ring = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.45) }
  70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0) }
  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0) }
`;
const sparkle = keyframes`
  0%,100% { transform: translateY(0) rotate(0deg); opacity:.95 }
  50%     { transform: translateY(-2px) rotate(12deg); opacity:1 }
`;
const slowSpin = keyframes`
  0% { transform: rotate(0deg) }
  100% { transform: rotate(360deg) }
`;
const dotPulse = keyframes`
  0%, 80%, 100% { transform: scale(.6); opacity:.45 }
  40% { transform: scale(1); opacity:1 }
`;

const Pill = styled("div")(({ ready }) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.3,
  position: "relative",
  userSelect: "none",
  WebkitBackdropFilter: "blur(6px)",
  backdropFilter: "blur(6px)",
  border: "1px solid",
  ...(ready
    ? {
        borderColor: "rgba(34,197,94,.28)",
        background: "linear-gradient(90deg,#ecfdf5,#e6fffb,#f0fdf4)",
        color: "#065f46",
        animation: `${pop} 380ms ease-out`,
      }
    : {
        borderColor: "rgba(148,163,184,.35)",
        background: "linear-gradient(90deg,#f8fafc,#eef2f7,#f8fafc)",
        backgroundSize: "200% 200%",
        color: "#334155",
        animation: `${shimmer} 2.3s linear infinite`,
      }),
}));

const Glow = styled("span")(({ ready }) => ({
  content: '""',
  position: "absolute",
  inset: -2,
  borderRadius: 999,
  pointerEvents: "none",
  ...(ready ? { animation: `${ring} 1.35s ease-out 1` } : {}),
}));

const Dots = styled("span")({
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  marginLeft: 4,
  "& > span": {
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: "#64748b",
    animation: `${dotPulse} 1.2s ease-in-out infinite`,
  },
  "& > span:nth-of-type(2)": { animationDelay: "0.15s" },
  "& > span:nth-of-type(3)": { animationDelay: "0.30s" },
});

function FallbacksIndicator({ ready }) {
  return (
    <Tooltip
      title={
        ready
          ? "Product catalog fully loaded. Using the latest NetSuite IDs by SKU."
          : "Loading more products in the background… fallback map is still improving."
      }
    >
      <Pill ready={ready ? 1 : 0}>
        {ready ? (
          <CheckCircleRoundedIcon sx={{ fontSize: 16 }} />
        ) : (
          <HourglassBottomRoundedIcon
            sx={{ fontSize: 16, animation: `${slowSpin} 1.6s linear infinite` }}
          />
        )}

        <span>{ready ? "Fallbacks Ready" : "Building fallbacks"}</span>

        {!ready ? (
          <Dots>
            <span />
            <span />
            <span />
          </Dots>
        ) : (
          <AutoAwesomeRoundedIcon
            sx={{
              fontSize: 14,
              ml: 0.25,
              animation: `${sparkle} 1.4s ease-in-out infinite`,
            }}
          />
        )}

        <Glow ready={ready ? 1 : 0} />
      </Pill>
    </Tooltip>
  );
}

export default FallbacksIndicator;
