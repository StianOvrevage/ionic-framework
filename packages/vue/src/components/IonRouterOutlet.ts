import {
  h,
  defineComponent,
  ref,
  computed,
  inject,
  provide,
  watch,
  shallowRef,
  InjectionKey,
  onUnmounted
} from 'vue';
import { AnimationBuilder } from '@ionic/core';
import { useRoute } from 'vue-router';
import { fireLifecycle, generateId, LIFECYCLE_DID_ENTER, LIFECYCLE_DID_LEAVE, LIFECYCLE_WILL_ENTER, LIFECYCLE_WILL_LEAVE } from '../utils';

let viewDepthKey: InjectionKey<0> = Symbol(0);
export const IonRouterOutlet = defineComponent({
  name: 'IonRouterOutlet',
  setup(_, { attrs }) {
    const route = useRoute();
    const depth = inject(viewDepthKey, 0);
    const matchedRouteRef: any = computed(() => {
      const matchedRoute = route.matched[depth];

      if (matchedRoute && attrs.tabs && route.matched[depth + 1]) {
        return route.matched[route.matched.length - 1];
      }

      return matchedRoute;
    });

    provide(viewDepthKey, depth + 1)

    const ionRouterOutlet = ref();
    const id = generateId('ion-router-outlet');

    // TODO types
    const ionRouter: any = inject('navManager');
    const viewStacks: any = inject('viewStacks');

    const components = shallowRef([]);

    let skipTransition = false;

    // The base url for this router outlet
    let parentOutletPath: string;

    watch(matchedRouteRef, (currentValue, previousValue) => {
      /**
       * We need to make sure that we are not re-rendering
       * the same view if navigation changes in a sub-outlet.
       * This is mainly for tabs when outlet 1 renders ion-tabs
       * and outlet 2 renders the individual tab view. We don't
       * want outlet 1 creating a new ion-tabs instance every time
       * we switch tabs.
       */
      if (currentValue !== previousValue) {
        setupViewItem(matchedRouteRef);
      }
    });

    const canStart = () => {
      const stack = viewStacks.getViewStack(id);
      if (!stack || stack.length <= 1) return false;

      /**
       * We only want to outlet of the entering view
       * to respond to this gesture, so check
       * to make sure the view is in the outlet we want.
       */
      const routeInfo = ionRouter.getCurrentRouteInfo();
      const enteringViewItem = viewStacks.findViewItemByRouteInfo({ pathname: routeInfo.pushedByRoute }, id);

      return !!enteringViewItem;
    }
    const onStart = async () => {
      const routeInfo = ionRouter.getCurrentRouteInfo();
      const { routerAnimation } = routeInfo;
      const enteringViewItem = viewStacks.findViewItemByRouteInfo({ pathname: routeInfo.pushedByRoute }, id);
      const leavingViewItem = viewStacks.findViewItemByRouteInfo(routeInfo, id);

      if (leavingViewItem) {
        let animationBuilder = routerAnimation;
        const enteringEl = enteringViewItem.ionPageElement;
        const leavingEl = leavingViewItem.ionPageElement;

        /**
        * If we are going back from a page that
        * was presented using a custom animation
        * we should default to using that
        * unless the developer explicitly
        * provided another animation.
        */
        const customAnimation = enteringViewItem.routerAnimation;
        if (
          animationBuilder === undefined &&
          // todo check for tab switch
          customAnimation !== undefined
        ) {
          animationBuilder = customAnimation;
        }

        leavingViewItem.routerAnimation = animationBuilder;

        await transition(
          enteringEl,
          leavingEl,
          'back',
          ionRouter.canGoBack(2),
          true,
          animationBuilder
        );
      }

      return Promise.resolve();
    }

    const onEnd = (shouldContinue: boolean) => {
      if (shouldContinue) {
        skipTransition = true;

        /**
         * Use the same logic as clicking
         * ion-back-button to determine where
         * to go back to.
         */
        ionRouter.handleNavigateBack();
      } else {
        /**
         * In the event that the swipe
         * gesture was aborted, we should
         * re-hide the page that was going to enter.
         */
        const routeInfo = ionRouter.getCurrentRouteInfo();
        const enteringViewItem = viewStacks.findViewItemByRouteInfo({ pathname: routeInfo.pushedByRoute }, id);
        enteringViewItem.ionPageElement.setAttribute('aria-hidden', 'true');
        enteringViewItem.ionPageElement.classList.add('ion-page-hidden');
      }
    }

    watch(ionRouterOutlet, () => {
      ionRouterOutlet.value.swipeHandler = {
        canStart,
        onStart,
        onEnd
      }
    });

    const transition = (
      enteringEl: HTMLElement,
      leavingEl: HTMLElement,
      direction: any, // TODO types
      showGoBack: boolean,
      progressAnimation: boolean,
      animationBuilder?: AnimationBuilder
    ) => {
      return new Promise(resolve => {
        if (skipTransition) {
          skipTransition = false;
          return resolve(false);
        }

        if (enteringEl === leavingEl) {
          return resolve(false);
        }

        requestAnimationFrame(() => {
          requestAnimationFrame(async () => {
            enteringEl.classList.add('ion-page-invisible');

            const result = await ionRouterOutlet.value.commit(enteringEl, leavingEl, {
              deepWait: true,
              duration: direction === undefined || direction === 'root' || direction === 'none' ? 0 : undefined,
              direction,
              showGoBack,
              progressAnimation,
              animationBuilder
            });

            return resolve(result);
          });
        });
      });
    }

    const handlePageTransition = async () => {
      const routeInfo = ionRouter.getCurrentRouteInfo();
      const { routerDirection, routerAction, routerAnimation } = routeInfo;

      const enteringViewItem = viewStacks.findViewItemByRouteInfo(routeInfo, id);
      const leavingViewItem = viewStacks.findLeavingViewItemByRouteInfo(routeInfo, id);
      const enteringEl = enteringViewItem.ionPageElement;

      if (enteringViewItem === leavingViewItem) return;

      fireLifecycle(enteringViewItem.vueComponentRef, LIFECYCLE_WILL_ENTER);

      if (leavingViewItem) {
        let animationBuilder = routerAnimation;
        const leavingEl = leavingViewItem.ionPageElement;

        fireLifecycle(leavingViewItem.vueComponentRef, LIFECYCLE_WILL_LEAVE);

        /**
        * If we are going back from a page that
        * was presented using a custom animation
        * we should default to using that
        * unless the developer explicitly
        * provided another animation.
        */
        const customAnimation = enteringViewItem.routerAnimation;
        if (
          animationBuilder === undefined &&
          routerDirection === 'back' &&
          // todo check for tab switch
          customAnimation !== undefined
        ) {
          animationBuilder = customAnimation;
        }

        leavingViewItem.routerAnimation = animationBuilder;

        await transition(
          enteringEl,
          leavingEl,
          routerDirection,
          !!routeInfo.pushedByRoute,
          false,
          animationBuilder
        );

        leavingEl.classList.add('ion-page-hidden');
        leavingEl.setAttribute('aria-hidden', 'true');

        if (!(routerAction === 'push' && routerDirection === 'forward')) {
          const shouldLeavingViewBeRemoved = routerDirection !== 'none' && leavingViewItem && (enteringViewItem !== leavingViewItem);
          if (shouldLeavingViewBeRemoved) {
            leavingViewItem.mount = false;
            leavingViewItem.ionPageElement = undefined;
            leavingViewItem.ionRoute = false;
          }
        }

        fireLifecycle(leavingViewItem.vueComponentRef, LIFECYCLE_DID_LEAVE);
      } else {
        /**
         * If there is no leaving element, just show
         * the entering element. Wrap it in an raf
         * in case ion-content's fullscreen callback
         * is running. Otherwise we'd have a flicker.
         */
        requestAnimationFrame(() => enteringEl.classList.remove('ion-page-invisible'));
      }

      fireLifecycle(enteringViewItem.vueComponentRef, LIFECYCLE_DID_ENTER);

      components.value = viewStacks.getChildrenToRender(id);
    }

    const setupViewItem = (matchedRouteRef: any) => {
      const firstMatchedRoute = route.matched[0];
      if (!parentOutletPath) {
        parentOutletPath = firstMatchedRoute.path;
      }

      /**
       * If no matched route, do not do anything in this outlet.
       * If there is a match, but it the first matched path
       * is not the root path for this outlet, then this view
       * change needs to be rendered in a different outlet.
       * We also add an exception for when the matchedRouteRef is
       * equal to the first matched route (i.e. the base router outlet).
       * This logic is mainly to help nested outlets/multi-tab
       * setups work better.
       */
      if (
        !matchedRouteRef.value ||
        (matchedRouteRef.value !== firstMatchedRoute && firstMatchedRoute.path !== parentOutletPath)
      ) {
          return;
      }

      const currentRoute = ionRouter.getCurrentRouteInfo();
      let enteringViewItem = viewStacks.findViewItemByRouteInfo(currentRoute, id);

      if (!enteringViewItem) {
        enteringViewItem = viewStacks.createViewItem(id, matchedRouteRef.value.components.default, matchedRouteRef.value, currentRoute);
        viewStacks.add(enteringViewItem);
      }

      if (!enteringViewItem.mount) {
        enteringViewItem.mount = true;
        enteringViewItem.registerCallback = () => {
          handlePageTransition();
          enteringViewItem.registerCallback = undefined;
        }
      } else {
        handlePageTransition();
      }

      components.value = viewStacks.getChildrenToRender(id);
    }

    if (matchedRouteRef.value) {
      setupViewItem(matchedRouteRef);
    }

    /**
     * Remove stack data for this outlet
     * when outlet is destroyed otherwise
     * we will see cached view data.
     */
    onUnmounted(() => viewStacks.clear(id));

    // TODO types
    const registerIonPage = (viewItem: any, ionPageEl: HTMLElement) => {
      const oldIonPageEl = viewItem.ionPageElement;

      viewStacks.registerIonPage(viewItem, ionPageEl);

      /**
       * If there is a registerCallback,
       * then this component is being registered
       * as a result of a navigation change.
       */
      if (viewItem.registerCallback) {
        viewItem.registerCallback();

      /**
       * If there is no registerCallback, then
       * this component is likely being re-registered
       * as a result of a hot module replacement.
       * We need to see if the oldIonPageEl has
       * .ion-page-invisible. If it does not then we
       * need to remove it from the new ionPageEl otherwise
       * the page will be hidden when it is replaced.
       */
      } else if (oldIonPageEl && !oldIonPageEl.classList.contains('ion-page-invisible')) {
        ionPageEl.classList.remove('ion-page-invisible');
      }
  };
    return {
      id,
      components,
      ionRouterOutlet,
      registerIonPage
    }
  },
  render() {
    const { components, registerIonPage } = this;

    return h(
      'ion-router-outlet',
      { ref: 'ionRouterOutlet' },
      // TODO types
      components && components.map((c: any) => {
        return h(
          c.vueComponent,
          {
            ref: c.vueComponentRef,
            key: c.pathname,
            isInOutlet: true,
            registerIonPage: (ionPageEl: HTMLElement) => registerIonPage(c, ionPageEl)
          }
        )
      })
    )
  }
});
