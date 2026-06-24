import { createHashRouter } from 'react-router-dom';
import Layout from '../components/Layout';
import React from 'react';
import { ContractProvider } from '../context/ContractContext';
import { DeployProvider } from '../context/DeployContext';
import { FullstackProvider } from '../context/FullstackContext';

const WrappedLayout = () => (
  <ContractProvider>
    <DeployProvider>
      <FullstackProvider>
        <Layout />
      </FullstackProvider>
    </DeployProvider>
  </ContractProvider>
);

const router = createHashRouter([
  {
    path: '/',
    element: <WrappedLayout />,
    errorElement: <WrappedLayout />,
  },
]);

export default router;
