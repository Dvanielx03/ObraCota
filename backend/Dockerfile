FROM maven:3.9-eclipse-temurin-21 AS tools
FROM eclipse-temurin:21.0.13_9-jdk-jammy AS build
COPY --from=tools /usr/share/maven /opt/maven
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.m2 /opt/maven/bin/mvn -B -ntp verify

FROM eclipse-temurin:21.0.13_9-jre-jammy
WORKDIR /srv
COPY --from=build /src/infrastructure/target/infrastructure-0.1.0.jar app.jar
RUN mkdir -p /srv/originals && chown 10001 /srv/originals
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=4s --start-period=45s CMD curl --fail --silent http://127.0.0.1:8080/actuator/health || exit 1
ENTRYPOINT ["java","-jar","app.jar"]
