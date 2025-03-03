import { getSdkError } from '@walletconnect/utils'
import React from 'react'
import { Trans, useTranslation } from 'react-i18next'
import 'react-native-reanimated'
import { useDispatch } from 'react-redux'
import { DappHeaderIcon } from 'src/components/Requests/DappHeaderIcon'
import { wcWeb3Wallet } from 'src/features/walletConnect/saga'
import { WalletConnectSession, removeSession } from 'src/features/walletConnect/walletConnectSlice'
import { DeprecatedButton, Flex, Text } from 'ui/src'
import { iconSizes } from 'ui/src/theme'
import { NetworkLogo } from 'uniswap/src/components/CurrencyLogo/NetworkLogo'
import { Modal } from 'uniswap/src/components/modals/Modal'
import { getChainLabel } from 'uniswap/src/features/chains/utils'
import { pushNotification } from 'uniswap/src/features/notifications/slice'
import { AppNotificationType } from 'uniswap/src/features/notifications/types'
import { ModalName } from 'uniswap/src/features/telemetry/constants'
import { WalletConnectEvent } from 'uniswap/src/types/walletConnect'
import { logger } from 'utilities/src/logger/logger'
import { ONE_SECOND_MS } from 'utilities/src/time/time'
import { useActiveAccountAddressWithThrow } from 'wallet/src/features/wallet/hooks'
interface DappConnectedNetworkModalProps {
  session: WalletConnectSession
  onClose: () => void
}

export function DappConnectedNetworkModal({ session, onClose }: DappConnectedNetworkModalProps): JSX.Element {
  const { t } = useTranslation()
  const address = useActiveAccountAddressWithThrow()
  const dispatch = useDispatch()
  const { dapp, id } = session

  const onDisconnect = async (): Promise<void> => {
    try {
      dispatch(removeSession({ account: address, sessionId: id }))
      // Explicitly verify that WalletConnect has this session id as an active session
      // It's possible that the session was already disconnected on WC but wasn't updated locally in redux
      const sessions = wcWeb3Wallet.getActiveSessions()
      if (sessions[session.id]) {
        await wcWeb3Wallet.disconnectSession({
          topic: session.id,
          reason: getSdkError('USER_DISCONNECTED'),
        })
      }
      dispatch(
        pushNotification({
          type: AppNotificationType.WalletConnect,
          address,
          dappName: dapp.name,
          event: WalletConnectEvent.Disconnected,
          imageUrl: dapp.icon,
          hideDelay: 3 * ONE_SECOND_MS,
        }),
      )
      onClose()
    } catch (error) {
      logger.error(error, { tags: { file: 'DappConnectedNetworkModal', function: 'onDisconnect' } })
    }
  }

  return (
    <Modal name={ModalName.WCDappConnectedNetworks} onClose={onClose}>
      <Flex centered gap="$spacing16" px="$spacing24" py="$spacing12">
        <Flex alignItems="center" gap="$spacing8">
          <DappHeaderIcon dapp={dapp} />
          <Text textAlign="center" variant="buttonLabel2">
            <Trans
              components={{ highlight: <Text variant="body1" /> }}
              i18nKey="walletConnect.dapps.connection"
              values={{ dappNameOrUrl: dapp.name || dapp.url }}
            />
          </Text>
          <Text color="$accent1" numberOfLines={1} textAlign="center" variant="buttonLabel2">
            {dapp.url}
          </Text>
        </Flex>
        <Flex row>
          <Flex
            grow
            borderColor="$surface3"
            borderRadius="$rounded12"
            borderWidth="$spacing1"
            gap="$spacing16"
            p="$spacing16"
          >
            {session.chains.map((chainId) => (
              <Flex key={chainId} row alignItems="center" justifyContent="space-between">
                <NetworkLogo chainId={chainId} size={iconSizes.icon24} />
                <Text color="$neutral1" numberOfLines={1} variant="body1">
                  {getChainLabel(chainId)}
                </Text>
                <Flex centered height={iconSizes.icon24} width={iconSizes.icon24}>
                  <Flex
                    backgroundColor="$statusSuccess"
                    borderRadius="$roundedFull"
                    height={iconSizes.icon8}
                    width={iconSizes.icon8}
                  />
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Flex>
        <Flex centered row gap="$spacing16">
          <DeprecatedButton fill theme="secondary" onPress={onClose}>
            {t('common.button.close')}
          </DeprecatedButton>
          <DeprecatedButton fill theme="detrimental" onPress={onDisconnect}>
            {t('common.button.disconnect')}
          </DeprecatedButton>
        </Flex>
      </Flex>
    </Modal>
  )
}
