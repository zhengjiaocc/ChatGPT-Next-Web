import { Analytics } from "@vercel/analytics/react";
import { getServerSideConfig } from "./config/server";
import dynamic from "next/dynamic";

const serverConfig = getServerSideConfig();

const Home = dynamic(() => import("./components/home"), {
  ssr: false,
});

export default async function App() {
  return (
    <>
      <Home />
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
