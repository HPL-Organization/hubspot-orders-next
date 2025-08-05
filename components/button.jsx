import React from "react";

const Button = ({ onClick, children, disabled, className }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className={` bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 ${className}`}
  >
    {children}
  </button>
);

export default Button;
