// components/RepContext.jsx
import React, { createContext, useContext, useState } from "react";

const RepContext = createContext();

export const useRep = () => useContext(RepContext);

export const RepProvider = ({ children }) => {
  const [repEmail, setRepEmail] = useState("");

  return (
    <RepContext.Provider value={{ repEmail, setRepEmail }}>
      {children}
    </RepContext.Provider>
  );
};
