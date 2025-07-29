import React from "react";

const Button = ({ onClick, children, disabled }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className={clsx(
      "px-4 py-2 rounded",
      disabled
        ? "bg-gray-400 cursor-not-allowed text-white"
        : "bg-blue-600 hover:bg-blue-700 text-white"
    )}
  >
    {children}
  </button>
);

export default Button;
