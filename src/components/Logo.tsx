export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Reader" className="logo">
      <rect width="1024" height="1024" rx="232" fill="#100F0F" />
      <text
        x="512"
        y="552"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Iowan Old Style, Palatino, Georgia, serif"
        fontSize="640"
        fontWeight="600"
        fill="#FFFCF0"
      >
        R
      </text>
    </svg>
  );
}
